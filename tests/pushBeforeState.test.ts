import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type RepoState } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
const state = {
  head: { branch: 'feature', hash: 'h1', detached: false, upstream: 'upstream/main', ahead: 1, behind: 0 },
  refs: [
    { name: 'feature', fullName: 'refs/heads/feature', type: 'head', hash: 'h1', upstream: 'upstream/main' },
    { name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', hash: 'h0' },
    { name: 'upstream/main', fullName: 'refs/remotes/upstream/main', type: 'remote', hash: 'h0' }
  ],
  stashes: [],
  remotes: [
    { name: 'origin', fetchUrl: 'https://example.com/fork.git', pushUrl: 'https://example.com/fork.git' },
    { name: 'upstream', fetchUrl: 'https://example.com/r.git', pushUrl: 'https://example.com/r.git' }
  ],
  status: { staged: [], unstaged: [], conflicted: [] },
  operation: null,
  unpushed: []
} as unknown as RepoState
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  getState: vi.fn(async () => state),
  push: vi.fn(async () => {})
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { push } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

beforeEach(() => {
  for (const fn of Object.values(stub)) fn.mockClear()
  // Just opened: the state is not read yet.
  const view = newRepoView('/r', 100)
  useStore.setState({
    settings: DEFAULT_SETTINGS,
    repos: { '/r': { ...view, state: null } },
    tabs: [{ id: '/r', path: '/r' }],
    activeTab: '/r',
    dialog: null
  })
})

describe('push before the state is read', () => {
  it('reads it from git to know where to publish, instead of pushing without asking', async () => {
    const pushing = push('/r')
    await vi.waitFor(() => expect(useStore.getState().dialog?.title).toBe('Publish feature to…'))
    useStore.getState().dialog!.resolve(null)

    expect(await pushing).toBe(false)
    expect(stub.push).not.toHaveBeenCalled()
  })
})
