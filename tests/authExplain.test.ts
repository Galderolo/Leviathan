import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type RepoState } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
const refused =
  "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/Galderolo/MMO.git/'"
let tokenState = { readable: true, reason: null as string | null }
const state = {
  head: { branch: 'main', hash: 'h1', detached: false, upstream: 'origin/main', ahead: 0, behind: 0 },
  refs: [],
  stashes: [],
  remotes: [
    {
      name: 'origin',
      fetchUrl: 'https://github.com/Galderolo/MMO.git',
      pushUrl: 'https://github.com/Galderolo/MMO.git'
    }
  ],
  status: { staged: [], unstaged: [], conflicted: [] },
  operation: null,
  unpushed: []
} as unknown as RepoState
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  getState: vi.fn(async () => state),
  fetch: vi.fn(async () => {
    throw new Error(refused)
  }),
  accountTokenState: vi.fn(async () => tokenState)
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { fetchAll } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

const account = {
  id: 'a1',
  provider: 'github',
  host: 'github.com',
  username: 'Galderolo',
  name: 'Galder',
  email: '1+Galderolo@users.noreply.github.com'
} as Account

beforeEach(() => {
  for (const fn of Object.values(stub)) fn.mockClear()
  tokenState = { readable: true, reason: null }
  useStore.setState({
    settings: DEFAULT_SETTINGS,
    repos: { '/r': { ...newRepoView('/r', 100), state, account } },
    tabs: [{ id: '/r', path: '/r' }],
    activeTab: '/r',
    dialog: null,
    toasts: [],
    settingsOpen: false,
    signInAgain: null
  })
})

describe("credentials the remote refused, with the repository's account", () => {
  it('says the token was revoked or expired instead of git, and signs in again from Settings', async () => {
    void fetchAll('/r')
    await vi.waitFor(() => expect(useStore.getState().dialog).not.toBeNull())
    const dialog = useStore.getState().dialog!

    expect(dialog.title).toBe('Sign in again to github.com')
    expect(dialog.message).toContain('github.com no longer accepts the token of Galderolo@github.com')
    expect(dialog.note).toContain('Invalid username or token')
    expect(useStore.getState().toasts.map((t) => t.text)).not.toContainEqual(refused)
    dialog.resolve({ choice: 'signin' })
    await vi.waitFor(() =>
      expect(useStore.getState()).toMatchObject({
        settingsOpen: true,
        settingsSection: 'accounts',
        signInAgain: 'github'
      })
    )
  })

  it('says why when the token cannot even be read on this computer', async () => {
    tokenState = { readable: false, reason: 'Error while decrypting the ciphertext' }
    void fetchAll('/r')
    await vi.waitFor(() => expect(useStore.getState().dialog).not.toBeNull())

    expect(useStore.getState().dialog!.message).toBe(
      'The token of Galderolo@github.com can no longer be read on this computer (Error while decrypting the ciphertext). Sign in again to keep a new one.'
    )
  })

  it("keeps git's message for a repository without an account", async () => {
    useStore.setState((s) => ({ repos: { '/r': { ...s.repos['/r'], account: null } } }))
    await fetchAll('/r')

    expect(useStore.getState().dialog).toBeNull()
    expect(useStore.getState().toasts.map((t) => t.text)).toContainEqual(refused)
  })
})
