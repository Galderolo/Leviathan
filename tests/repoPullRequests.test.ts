import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The accounts module runs in Electron's main process: stand in for the parts it uses.
const userData = mkdtempSync(join(tmpdir(), 'leviathan-prs-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (data: Buffer) => data.toString().split('').reverse().join('')
  }
}))

const TOKEN = 'ghp_secret_for_tests'
const requests: { url: string; auth?: string; method?: string; body?: unknown }[] = []
const pr = {
  number: 12,
  title: 'Add login',
  user: { login: 'ana' },
  head: { ref: 'login', repo: { full_name: 'org/app' } },
  base: { ref: 'main', repo: { full_name: 'org/app' } },
  draft: false,
  html_url: 'https://github.com/org/app/pull/12',
  updated_at: '2026-10-21T00:00:00Z'
}
vi.stubGlobal(
  'fetch',
  async (url: string, init?: { headers?: Record<string, string>; method?: string; body?: string }) => {
    requests.push({
      url,
      auth: init?.headers?.Authorization,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined
    })
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    if (url === 'https://api.github.com/user') return json(200, { login: 'ana', id: 1, name: 'Ana' })
    if (url.startsWith('https://api.github.com/repos/org/app/pulls?')) return json(200, [pr])
    if (url === 'https://api.github.com/repos/org/app/pulls') return json(201, pr)
    if (url === 'https://api.github.com/repos/org/app') return json(200, { default_branch: 'main' })
    return json(404, {})
  }
)

const accounts = await import('../src/main/accounts')
const repo = await import('../src/main/git/repository')
const { git } = await import('../src/main/git/runner')

let work: string
let other: string

beforeAll(async () => {
  work = await repo.initRepo(join(userData, 'work'), 'main')
  await git(['remote', 'add', 'origin', 'git@github.com:org/app.git'], { cwd: work })
  other = await repo.initRepo(join(userData, 'other'), 'main')
  await git(['remote', 'add', 'origin', 'https://gitlab.com/org/app.git'], { cwd: other })
  await accounts.addAccount({ provider: 'github', host: 'github.com', token: TOKEN })
})

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('pull requests of a repository', () => {
  it('lists them through the account on the remote host', async () => {
    const result = await accounts.getPullRequests(work)
    expect(result).toMatchObject({ provider: 'github', remote: 'origin' })
    expect(result?.items.map((p) => p.number)).toEqual([12])
    const call = requests.find((r) => r.url.startsWith('https://api.github.com/repos/org/app/pulls?'))
    expect(call?.auth).toBe(`Bearer ${TOKEN}`)
  })

  it('has nothing to show when no account is on the remote host', async () => {
    expect(await accounts.getPullRequests(other)).toBeNull()
    expect(await accounts.getDefaultBranch(other)).toBeNull()
  })

  it('creates one and reads the default branch', async () => {
    expect(await accounts.getDefaultBranch(work)).toBe('main')
    const created = await accounts.createRepoPullRequest(work, {
      title: '  Add login ',
      body: '',
      source: 'login',
      target: 'main',
      draft: false
    })
    expect(created.number).toBe(12)
    expect(requests.at(-1)?.body).toMatchObject({ title: 'Add login', head: 'login', base: 'main' })
  })

  it('refuses malformed input from the renderer', async () => {
    await expect(
      accounts.createRepoPullRequest(work, { title: '', body: '', source: 'x', target: 'main', draft: false })
    ).rejects.toThrow(/Invalid/)
    await expect(
      accounts.createRepoPullRequest(work, { title: 'T', body: 1, source: 'x', target: 'main' } as never)
    ).rejects.toThrow(/Invalid/)
  })

  it('never hands the token to the renderer', async () => {
    const result = await accounts.getPullRequests(work)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})
