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
    if (url === 'https://api.github.com/repos/org/app/pulls/12') return json(200, { ...pr, state: 'closed' })
    if (url === 'https://api.github.com/repos/org/app/pulls/12/merge') return json(200, { merged: true })
    if (url === 'https://api.github.com/repos/org/app/issues/12/comments') {
      return json(201, { id: 1, user: { login: 'ana' }, body: 'Thanks', created_at: '2026-10-23T00:00:00Z' })
    }
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

  it('refuses a pasted token with spaces or line breaks inside, without repeating it', async () => {
    const broken = 'ghp_part_one' + String.fromCharCode(10) + 'part_two'
    const error = (await accounts
      .addAccount({ provider: 'github', host: 'github.com', token: broken })
      .catch((e) => e)) as Error
    expect(error.message).toMatch(/token/i)
    expect(error.message).not.toContain('part_two')
  })

  it('closes one through the account', async () => {
    await accounts.closeRepoPullRequest(work, 12, pr.html_url)
    expect(requests.at(-1)).toMatchObject({
      url: 'https://api.github.com/repos/org/app/pulls/12',
      method: 'PATCH',
      body: { state: 'closed' },
      auth: `Bearer ${TOKEN}`
    })
    await expect(accounts.closeRepoPullRequest(other, 12, pr.html_url)).rejects.toThrow(/No account/)
  })

  it('refuses to close when the pull request is not the one the list showed', async () => {
    const before = requests.length
    await expect(accounts.closeRepoPullRequest(work, 12, 'https://github.com/someone/else/pull/12')).rejects.toThrow(
      /not the one/i
    )
    expect(requests.slice(before).some((r) => r.method === 'PATCH')).toBe(false)
  })

  it('merges a reviewed pull request only while it is still the one the review showed', async () => {
    const before = requests.length
    const head = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
    await expect(
      accounts.mergeRepoPullRequest(work, 12, 'https://github.com/someone/else/pull/12', 'merge', head)
    ).rejects.toThrow(/not the one/i)
    expect(requests.slice(before).some((r) => r.method === 'PUT')).toBe(false)

    await accounts.mergeRepoPullRequest(work, 12, pr.html_url, 'squash', head)
    expect(requests.at(-1)).toMatchObject({
      url: 'https://api.github.com/repos/org/app/pulls/12/merge',
      method: 'PUT',
      body: { merge_method: 'squash', sha: head }
    })
    await expect(accounts.mergeRepoPullRequest(work, 12, pr.html_url, 'octopus' as never, head)).rejects.toThrow()
    // Approving is tied to the reviewed commit, and to the pull request the review showed, too.
    await expect(
      accounts.approveRepoPullRequest(work, 12, 'https://github.com/someone/else/pull/12', head)
    ).rejects.toThrow(/not the one/i)
  })

  it("offers the merge methods the project allows, read with the account's token", async () => {
    // This project's answer has no merge settings: every method stays on offer.
    expect(await accounts.getMergeMethods(work, 'main')).toEqual(['merge', 'squash', 'rebase'])
    expect(requests.at(-1)).toMatchObject({ url: 'https://api.github.com/repos/org/app', auth: `Bearer ${TOKEN}` })
    await expect(accounts.getMergeMethods(work, '' as never)).rejects.toThrow()
    await expect(accounts.getMergeMethods(other, 'main')).rejects.toThrow(/No account/)
  })

  it('comments on a pull request, refusing an empty comment', async () => {
    await expect(accounts.commentOnPullRequest(work, 12, '   ')).rejects.toThrow(/empty/)
    expect((await accounts.commentOnPullRequest(work, 12, ' Thanks ')).body).toBe('Thanks')
    expect(requests.at(-1)?.body).toEqual({ body: 'Thanks' })
  })

  it('never hands the token to the renderer', async () => {
    const result = await accounts.getPullRequests(work)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})
