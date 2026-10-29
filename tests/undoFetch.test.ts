import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type RepoState } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
let finishFetch: () => void = () => {}
let finishCommit: () => void = () => {}
const snapshot = { head: { branch: 'main', hash: 'h1' }, refs: {}, stash: [] }
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  fetch: vi.fn(() => new Promise<void>((resolve) => (finishFetch = resolve))),
  commit: vi.fn(() => new Promise<void>((resolve) => (finishCommit = resolve))),
  getSnapshot: vi.fn(async () => snapshot),
  getState: vi.fn(async () => state)
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { autoFetchTick, commit, fetchInBackground } = await import('../src/renderer/src/actions')
const { newRepoView, patchRepo, useStore } = await import('../src/renderer/src/store')

const state = {
  head: { branch: 'main', hash: 'h1', detached: false, upstream: 'origin/main', ahead: 0, behind: 0 },
  refs: [],
  stashes: [],
  remotes: [{ name: 'origin', fetchUrl: 'https://example.com/r.git', pushUrl: 'https://example.com/r.git' }],
  status: { staged: [{ path: 'a.txt', status: 'M' }], unstaged: [], conflicted: [] },
  operation: null,
  unpushed: []
} as unknown as RepoState

beforeEach(() => {
  for (const fn of Object.values(stub)) fn.mockClear()
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, autoFetchMinutes: 1 },
    repos: { '/r': { ...newRepoView('/r', 100), state } },
    tabs: [{ id: '/r', path: '/r' }],
    activeTab: '/r'
  })
  patchRepo('/r', (r) => ({ draft: { ...r.draft, summary: 'Change' } }))
})

// Tags a fetch brings would be part of what the action changed: undoing it would delete them.
describe('background fetches and what can be undone', () => {
  it('lets a background fetch finish before an action records what it changes', async () => {
    const fetching = fetchInBackground('/r')
    await vi.waitFor(() => expect(stub.fetch).toHaveBeenCalledTimes(1))
    const committing = commit('/r')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stub.getSnapshot).not.toHaveBeenCalled()
    finishFetch()
    await vi.waitFor(() => expect(stub.commit).toHaveBeenCalled())
    finishCommit()
    expect(await committing).toBe(true)
    await fetching
  })

  it('starts no background fetch while an action is being recorded', async () => {
    const committing = commit('/r')
    await vi.waitFor(() => expect(stub.commit).toHaveBeenCalled())
    autoFetchTick()
    expect(stub.fetch).not.toHaveBeenCalled()
    finishCommit()
    expect(await committing).toBe(true)
    autoFetchTick()
    await vi.waitFor(() => expect(stub.fetch).toHaveBeenCalledTimes(1))
    finishFetch()
  })
})
