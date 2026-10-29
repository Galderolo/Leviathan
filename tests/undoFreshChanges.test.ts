import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type RepoState } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
const snapshot = (files: Record<string, unknown>) => ({
  head: { branch: 'main', hash: 'h1' },
  refs: {},
  stash: [],
  files
})
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  getState: vi.fn(async () => state),
  getSnapshot: vi.fn(async () => snapshot({})),
  stashSave: vi.fn(async () => {}),
  discardAll: vi.fn(async () => {})
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { discardAll, stashChanges } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

// What the app saw at its last refresh: one file, though git may have more by now.
const state = {
  head: { branch: 'main', hash: 'h1', detached: false, upstream: null, ahead: 0, behind: 0 },
  refs: [],
  stashes: [],
  remotes: [],
  status: { staged: [], unstaged: [{ path: 'new.txt', status: '?' }], conflicted: [] },
  operation: null,
  unpushed: []
} as unknown as RepoState

beforeEach(() => {
  for (const fn of Object.values(stub)) fn.mockClear()
  useStore.setState({
    settings: DEFAULT_SETTINGS,
    repos: { '/r': { ...newRepoView('/r', 100), state } },
    tabs: [{ id: '/r', path: '/r' }],
    activeTab: '/r',
    dialog: null,
    toasts: []
  })
})

describe('undoing a stash or discard of every change', () => {
  it('copies the changes git has, not those of the last refresh, and compares the same files after', async () => {
    stub.getSnapshot.mockResolvedValueOnce(snapshot({ 'a.txt': {}, 'new.txt': {} }))
    await stashChanges('/r')

    expect(stub.stashSave).toHaveBeenCalled()
    expect(stub.getSnapshot.mock.calls.slice(0, 2)).toEqual([
      ['/r', 'changes'],
      ['/r', ['a.txt', 'new.txt']]
    ])
  })

  it('asks git before saying there is nothing to stash, as the last refresh may not have seen a change yet', async () => {
    const clean = { ...state, status: { staged: [], unstaged: [], conflicted: [] } } as unknown as RepoState
    useStore.setState({ repos: { '/r': { ...newRepoView('/r', 100), state: clean } } })
    await stashChanges('/r')

    expect(stub.stashSave).toHaveBeenCalled()
    expect(useStore.getState().toasts.map((t) => t.text)).not.toContain('There are no changes to stash')
  })

  it('does the same for discarding everything', async () => {
    const discarding = discardAll('/r')
    await vi.waitFor(() => expect(useStore.getState().dialog).not.toBeNull())
    useStore.getState().dialog!.resolve({})
    await discarding

    expect(stub.discardAll).toHaveBeenCalled()
    expect(stub.getSnapshot.mock.calls[0]).toEqual(['/r', 'changes'])
  })
})
