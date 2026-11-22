import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The account store needs Electron; the server is not asked. The "created" project is a bare repository here.
vi.mock('../src/main/accounts', () => ({ publishingAccount: vi.fn(), setRepoAccount: vi.fn() }))
vi.mock('../src/main/accounts/providers', () => ({ createProject: vi.fn() }))

const accounts = await import('../src/main/accounts')
const providers = await import('../src/main/accounts/providers')
const { publishRepository } = await import('../src/main/publish')
const { git } = await import('../src/main/git/runner')

const ana = {
  id: 'a1',
  provider: 'github' as const,
  host: 'github.com',
  username: 'ana',
  name: 'Ana',
  email: '5+ana@users.noreply.github.com'
}
const input = { accountId: 'a1', name: 'game', description: ' A game ', private: true }
const clean = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false']

let root: string
let work: string
let bare: string

const remotes = async () => (await git(['remote'], { cwd: work })).stdout.trim()

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-publish-'))
  work = join(root, 'work')
  bare = join(root, 'remote.git')
  await git(['init', '-q', '--bare', '-b', 'main', bare], { cwd: root })
  await git(['init', '-q', '-b', 'main', work], { cwd: root })
  await git([...clean, 'commit', '-q', '--allow-empty', '-m', 'first'], { cwd: work })
  vi.mocked(accounts.publishingAccount).mockReset().mockResolvedValue({ account: ana, token: 'tok' })
  vi.mocked(accounts.setRepoAccount).mockReset().mockResolvedValue(undefined)
  vi.mocked(providers.createProject)
    .mockReset()
    .mockResolvedValue({ fullName: 'ana/game', cloneUrl: bare, webUrl: 'https://github.com/ana/game' })
})

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('publishRepository', () => {
  it('creates the project, adds it as origin and gives the repository the account', async () => {
    const published = await publishRepository(work, input)

    expect(published).toEqual({
      fullName: 'ana/game',
      webUrl: 'https://github.com/ana/game',
      host: 'github.com',
      bindError: null
    })
    expect(providers.createProject).toHaveBeenCalledWith('github', 'github.com', 'tok', {
      name: 'game',
      description: 'A game',
      private: true,
      branch: 'main',
      workspace: undefined
    })
    expect((await git(['remote', 'get-url', 'origin'], { cwd: work })).stdout.trim()).toBe(bare)
    expect(accounts.setRepoAccount).toHaveBeenCalledWith(work, 'a1', { keepIdentity: false })
    // The push that follows reaches it.
    await git(['push', '-q', 'origin', 'main'], { cwd: work })
    const pushed = (await git(['rev-parse', 'main'], { cwd: bare })).stdout.trim()
    expect(pushed).toBe((await git(['rev-parse', 'main'], { cwd: work })).stdout.trim())
  })

  it("keeps a repository's own identity", async () => {
    await git(['config', '--local', 'user.name', 'Own'], { cwd: work })
    await publishRepository(work, input)
    expect(accounts.setRepoAccount).toHaveBeenCalledWith(work, 'a1', { keepIdentity: true })
  })

  it('reads the branch of a repository with no commits yet', async () => {
    const empty = join(root, 'empty')
    await git(['init', '-q', '-b', 'trunk', empty], { cwd: root })
    await publishRepository(empty, input)
    expect(vi.mocked(providers.createProject).mock.calls[0][3].branch).toBe('trunk')
  })

  it('refuses a repository that has origin already, before asking the server', async () => {
    await git(['remote', 'add', 'origin', bare], { cwd: work })
    await expect(publishRepository(work, input)).rejects.toThrow('This repository already has a remote named origin')
    expect(providers.createProject).not.toHaveBeenCalled()
  })

  it('leaves the repository as it was when the server refuses', async () => {
    vi.mocked(providers.createProject).mockRejectedValue(
      new Error('GitHub answered with an error (422): name already exists on this account')
    )
    await expect(publishRepository(work, input)).rejects.toThrow('name already exists on this account')
    expect(await remotes()).toBe('')
    expect(accounts.setRepoAccount).not.toHaveBeenCalled()
  })

  it('says where the project is when it cannot be added as origin', async () => {
    vi.mocked(providers.createProject).mockResolvedValue({
      fullName: 'ana/game',
      cloneUrl: '-not-a-url',
      webUrl: 'https://github.com/ana/game'
    })
    await expect(publishRepository(work, input)).rejects.toThrow(
      /The project was created at https:\/\/github\.com\/ana\/game, but it could not be added as origin/
    )
  })

  it('is published all the same when the account cannot be given to the repository', async () => {
    vi.mocked(accounts.setRepoAccount).mockRejectedValue(new Error('settings.json is read-only'))
    const published = await publishRepository(work, input)
    expect(published.bindError).toBe('settings.json is read-only')
    expect(await remotes()).toBe('origin')
  })

  it('refuses a name no server takes, before anything else', async () => {
    await expect(publishRepository(work, { ...input, name: 'my game' })).rejects.toThrow('Invalid repository name')
    expect(accounts.publishingAccount).not.toHaveBeenCalled()
  })

  it('needs a workspace for Bitbucket', async () => {
    vi.mocked(accounts.publishingAccount).mockResolvedValue({
      account: { ...ana, provider: 'bitbucket', host: 'bitbucket.org' },
      token: 'tok'
    })
    await expect(publishRepository(work, input)).rejects.toThrow(/workspace/)
    expect(providers.createProject).not.toHaveBeenCalled()
  })

  it('refuses what is not a publish request', async () => {
    await expect(publishRepository(work, { ...input, private: 'yes' } as never)).rejects.toThrow(
      'Invalid repository to publish'
    )
  })
})
