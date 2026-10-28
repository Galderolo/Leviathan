import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, RepoState } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
const work: Account = {
  id: 'work',
  provider: 'github',
  host: 'github.com',
  username: 'ana-work',
  name: 'Ana',
  email: 'ana@studio.example'
}
let onHost = true
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  listAccounts: vi.fn(async () => [work]),
  getRepoAccount: vi.fn(async () => null),
  setRepoAccount: vi.fn(async () => {}),
  repoUsesHost: vi.fn(async () => onHost),
  listPullRequests: vi.fn(async () => [])
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { chooseRepoAccount } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

/** A remote through an SSH alias (`Host github-work` in ~/.ssh/config), the usual way to use two accounts. */
const aliased = {
  remotes: [{ name: 'origin', fetchUrl: 'git@github-work:studio/game.git', pushUrl: 'git@github-work:studio/game.git' }]
} as unknown as RepoState

async function bind() {
  const choosing = chooseRepoAccount('/game')
  await vi.waitFor(() => expect(useStore.getState().dialog).not.toBeNull())
  useStore.getState().dialog!.resolve({ account: 'work' })
  await choosing
}

const infos = () =>
  useStore
    .getState()
    .toasts.filter((x) => x.kind === 'info')
    .map((x) => x.text)

beforeEach(() => {
  useStore.setState({
    toasts: [],
    dialog: null,
    repos: { '/game': { ...newRepoView('/game', 100), state: aliased } },
    tabs: [{ id: '/game', path: '/game' }],
    activeTab: '/game'
  })
})

describe('binding a repository to an account', () => {
  it('does not warn about the host when a remote reaches it through an SSH alias', async () => {
    onHost = true
    await bind()
    expect(stub.repoUsesHost).toHaveBeenCalledWith('/game', 'github.com')
    expect(infos()).toEqual([])
  })

  it("warns when no remote reaches the account's host", async () => {
    onHost = false
    await bind()
    expect(infos()).toEqual([expect.stringContaining('github.com')])
  })
})
