import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Account } from '../src/shared/types'

// The accounts module runs in Electron's main process: stand in for the parts it uses.
const userData = mkdtempSync(join(tmpdir(), 'leviathan-identity-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptStringAsync: async (text: string) => Buffer.from(text.split('').reverse().join('')),
    decryptStringAsync: async (data: Buffer) => ({
      result: data.toString().split('').reverse().join(''),
      shouldReEncrypt: false
    })
  }
}))

// ssh reads its config for an alias: github-work is github.com, as a ~/.ssh/config `Host github-work` would say.
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const execFile = (file: string, args: string[], opts: unknown, done: (err: Error | null, out: string) => void) => {
    if (file !== 'ssh') return (real.execFile as unknown as (...a: unknown[]) => unknown)(file, args, opts, done)
    const host = args[args.length - 1]
    done(null, `user git\nhostname ${host === 'github-work' ? 'github.com' : host}\n`)
  }
  return { ...real, execFile }
})

const asked: string[] = []
vi.stubGlobal('fetch', async (url: string) => {
  asked.push(url)
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
  if (url === 'https://api.github.com/user') return json(200, { login: 'ana', id: 1, name: 'Ana' })
  // ana may push to the studio's game, not to someone's library.
  if (url === 'https://api.github.com/repos/studio/game') return json(200, { permissions: { push: true } })
  if (url === 'https://api.github.com/repos/someone/lib') return json(200, { permissions: { push: false } })
  return json(404, {})
})

// A global identity of its own, never the machine's.
const globalConfig = join(userData, 'gitconfig')
writeFileSync(globalConfig, '[user]\n\tname = Global Me\n\temail = me@home.example\n')
process.env.GIT_CONFIG_GLOBAL = globalConfig

const accounts = await import('../src/main/accounts')
const repo = await import('../src/main/git/repository')
const { git } = await import('../src/main/git/runner')
const { loadSettings } = await import('../src/main/settings')

let ana: Account

async function repoWith(name: string, url?: string): Promise<string> {
  const dir = await repo.initRepo(join(userData, name), 'main')
  if (url) await git(['remote', 'add', 'origin', url], { cwd: dir })
  return dir
}

async function local(dir: string, key: string): Promise<string> {
  return (await git(['config', '--local', '--get', key], { cwd: dir, okCodes: [0, 1] })).stdout.trim()
}

beforeAll(async () => {
  ana = await accounts.addAccount({ provider: 'github', host: 'github.com', token: 'ghp_test' })
})

afterAll(() => {
  delete process.env.GIT_CONFIG_GLOBAL
  rmSync(userData, { recursive: true, force: true })
})

describe('commit identity of a repository', () => {
  it('says where it comes from, and changes it for that repository only', async () => {
    const dir = await repoWith('plain')
    expect(await accounts.getCommitIdentity(dir)).toEqual({
      name: 'Global Me',
      email: 'me@home.example',
      source: 'global',
      accountId: null
    })

    await accounts.setCommitIdentity(dir, { name: 'Ana Work', email: 'ana@studio.example' })
    expect(await accounts.getCommitIdentity(dir)).toMatchObject({ name: 'Ana Work', source: 'repo' })
    expect(await local(dir, 'user.email')).toBe('ana@studio.example')
    expect(loadSettings().recentIdentities[0]).toEqual({ name: 'Ana Work', email: 'ana@studio.example' })

    await accounts.setCommitIdentity(dir, { account: ana.id })
    expect(await accounts.getCommitIdentity(dir)).toMatchObject({ source: 'account', accountId: ana.id })
    expect(await local(dir, 'user.email')).toBe(ana.email)

    await accounts.setCommitIdentity(dir, 'global')
    expect(await accounts.getCommitIdentity(dir)).toMatchObject({ name: 'Global Me', source: 'global' })
    expect(await local(dir, 'user.name')).toBe('')
  })

  it('takes the identity of the account that owns the project, when the repository has none of its own', async () => {
    const dir = await repoWith('owned', 'git@github.com:ana/game.git')
    await accounts.ensureDefaultIdentity(dir)
    expect(accounts.getRepoAccount(dir)).toBe(ana.id)
    expect(await accounts.getCommitIdentity(dir)).toMatchObject({ source: 'account', email: ana.email })
  })

  it('finds the account of a remote reached through an SSH alias', async () => {
    const dir = await repoWith('aliased', 'git@github-work:ana/tool.git')
    await accounts.ensureDefaultIdentity(dir)
    expect(accounts.getRepoAccount(dir)).toBe(ana.id)
  })

  it('or of an account that may push to it', async () => {
    const dir = await repoWith('studio', 'https://github.com/studio/game.git')
    await accounts.ensureDefaultIdentity(dir)
    expect(accounts.getRepoAccount(dir)).toBe(ana.id)
    expect(asked).toContain('https://api.github.com/repos/studio/game')
  })

  it('leaves alone a repository with an identity of its own, and one no account may push to', async () => {
    const own = await repoWith('own', 'git@github.com:ana/other.git')
    await git(['config', 'user.email', 'ana@studio.example'], { cwd: own })
    await accounts.ensureDefaultIdentity(own)
    expect(accounts.getRepoAccount(own)).toBeNull()
    expect(await local(own, 'user.email')).toBe('ana@studio.example')

    const lib = await repoWith('lib', 'https://github.com/someone/lib.git')
    await accounts.ensureDefaultIdentity(lib)
    expect(accounts.getRepoAccount(lib)).toBeNull()
    expect(await accounts.getCommitIdentity(lib)).toMatchObject({ source: 'global' })
  })

  it("renames the account's identity in the repositories that still have it, not in those given another", async () => {
    const kept = await repoWith('kept', 'git@github.com:ana/a.git')
    const changed = await repoWith('changed', 'git@github.com:ana/b.git')
    await accounts.ensureDefaultIdentity(kept)
    await accounts.ensureDefaultIdentity(changed)
    await accounts.setCommitIdentity(changed, { name: 'Ana Work', email: 'ana@studio.example' })

    await accounts.updateAccount(ana.id, { name: 'Ana Renamed' })
    expect(await local(kept, 'user.name')).toBe('Ana Renamed')
    expect(await local(changed, 'user.name')).toBe('Ana Work')
  })
})
