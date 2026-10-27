import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The accounts module runs in Electron's main process: stand in for the parts it uses.
const userData = mkdtempSync(join(tmpdir(), 'leviathan-bitbucket-'))
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

const API = 'https://api.bitbucket.org/2.0'
let emailsAllowed = true
let noUsername = false
const requests: { url: string; auth?: string }[] = []
vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
  requests.push({ url, auth: init?.headers?.Authorization })
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
  if (url === `${API}/user`)
    return json(200, { ...(noUsername ? {} : { username: 'dcervera1' }), display_name: 'David', nickname: 'dc' })
  if (url === `${API}/user/emails?pagelen=100`) {
    return emailsAllowed
      ? json(200, { values: [{ email: 'david@studio.example', is_primary: true, is_confirmed: true }] })
      : json(403, {})
  }
  if (url === `${API}/repositories/studio/game/pullrequests?state=OPEN&sort=-updated_on&pagelen=50`) {
    return json(200, {
      values: [
        {
          id: 7,
          title: 'Rising mode',
          author: { display_name: 'Ana' },
          source: { branch: { name: 'feature/rising-mode' }, repository: { full_name: 'studio/game' } },
          destination: { branch: { name: 'develop' }, repository: { full_name: 'studio/game' } },
          links: { html: { href: 'https://bitbucket.org/studio/game/pull-requests/7' } },
          updated_on: '2026-10-22T00:00:00Z'
        }
      ]
    })
  }
  return json(404, {})
})

const accounts = await import('../src/main/accounts')
const repo = await import('../src/main/git/repository')
const { git } = await import('../src/main/git/runner')

beforeEach(() => {
  emailsAllowed = true
  noUsername = false
  for (const account of accounts.listAccounts()) accounts.removeAccount(account.id)
})

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('Bitbucket accounts', () => {
  it('are added with an API token: the username of the remotes and the primary email', async () => {
    const account = await accounts.addAccount({ provider: 'bitbucket', host: 'bitbucket.org', token: 'ATATT-secret' })
    expect(account).toMatchObject({ username: 'dcervera1', name: 'David', email: 'david@studio.example' })
    expect(requests.at(-1)?.auth).toBe('Bearer ATATT-secret')
  })

  it('added again keep the account, with the new token and the name and email typed', async () => {
    const first = await accounts.addAccount({ provider: 'bitbucket', host: 'bitbucket.org', token: 'ATATT-old' })
    const again = await accounts.addAccount({
      provider: 'bitbucket',
      host: 'bitbucket.org',
      token: 'ATATT-new',
      name: 'David C.',
      email: 'dc@studio.example'
    })
    expect(again).toMatchObject({ id: first.id, name: 'David C.', email: 'dc@studio.example' })
    expect(accounts.listAccounts()).toHaveLength(1)
    await accounts.listAccountRepos(first.id).catch(() => [])
    expect(requests.at(-1)?.auth).toBe('Bearer ATATT-new')

    // Nothing typed: the name and email stay as they were.
    const third = await accounts.addAccount({ provider: 'bitbucket', host: 'bitbucket.org', token: 'ATATT-third' })
    expect(third).toMatchObject({ name: 'David C.', email: 'dc@studio.example' })
  })

  it('ask for the commit email when the token may not read it, and take the username typed', async () => {
    emailsAllowed = false
    await expect(
      accounts.addAccount({ provider: 'bitbucket', host: 'bitbucket.org', token: 'ATATT-secret' })
    ).rejects.toThrow('commit email')
    const account = await accounts.addAccount({
      provider: 'bitbucket',
      host: 'bitbucket.org',
      token: 'ATATT-secret',
      username: 'DCervera1',
      email: 'me@studio.example'
    })
    expect(account).toMatchObject({ username: 'DCervera1', email: 'me@studio.example' })
  })

  it('ask for the username when Bitbucket does not give it', async () => {
    noUsername = true
    await expect(
      accounts.addAccount({ provider: 'bitbucket', host: 'bitbucket.org', token: 'ATATT-secret' })
    ).rejects.toThrow('username')
    const account = await accounts.addAccount({
      provider: 'bitbucket',
      host: 'bitbucket.org',
      token: 'ATATT-secret',
      username: 'dcervera1'
    })
    expect(account.username).toBe('dcervera1')
  })

  it('are Bitbucket Cloud only: a Data Center server goes as "Other"', async () => {
    await expect(
      accounts.addAccount({ provider: 'bitbucket', host: 'git.studio.example', token: 'x' })
    ).rejects.toThrow('Other')
  })

  it("list the pull requests of a repository whose remote is on Bitbucket (the URL's username is not part of the project)", async () => {
    await accounts.addAccount({ provider: 'bitbucket', host: 'bitbucket.org', token: 'ATATT-secret' })
    const work = await repo.initRepo(join(userData, 'work'), 'main')
    await git(['remote', 'add', 'origin', 'https://dcervera1@bitbucket.org/studio/game.git'], { cwd: work })
    const prs = await accounts.getPullRequests(work)
    expect(prs?.provider).toBe('bitbucket')
    expect(prs?.items.map((p) => [p.number, p.sourceBranch, p.targetBranch, p.fromFork])).toEqual([
      [7, 'feature/rising-mode', 'develop', false]
    ])
  })
})
