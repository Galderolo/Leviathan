import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffSource, RepoState } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
let finishResolve: () => void = () => {}
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  conflictFileEdited: vi.fn(async () => false),
  resolveConflictWith: vi.fn(() => new Promise<void>((resolve) => (finishResolve = resolve))),
  resolveConflictFile: vi.fn(() => new Promise<void>((resolve) => (finishResolve = resolve))),
  getSnapshot: vi.fn(async () => null),
  getState: vi.fn(async () => state)
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { resolveWithContent, resolveWithSide } = await import('../src/renderer/src/actions')
const { getRepo, newRepoView, patchRepo, useStore } = await import('../src/renderer/src/store')

const state = {
  head: { branch: 'main', hash: 'h1', detached: false, upstream: null, ahead: 0, behind: 0 },
  refs: [],
  remotes: [],
  stashes: [],
  status: { staged: [], unstaged: [], conflicted: [{ path: 'b.txt', status: 'U' }] },
  operation: 'merge'
} as unknown as RepoState

const conflict = (file: string): DiffSource => ({ kind: 'unstaged', path: file, conflicted: true })
const shown = () => getRepo('/game')?.diff?.source ?? null

beforeEach(() => {
  useStore.setState({
    repos: { '/game': { ...newRepoView('/game', 100), state } },
    tabs: [{ id: '/game', path: '/game' }],
    activeTab: '/game'
  })
})

describe('resolving a conflicted file', () => {
  it('closes its own view, not the one of the file opened meanwhile', async () => {
    patchRepo('/game', { diff: { source: conflict('a.txt'), data: null } })
    const resolving = resolveWithSide('/game', 'a.txt', 'ours')
    await vi.waitFor(() => expect(stub.resolveConflictWith).toHaveBeenCalled())
    // The next file opened before the first one is done.
    patchRepo('/game', { diff: { source: conflict('b.txt'), data: null } })
    finishResolve()
    expect(await resolving).toBe(true)
    expect(shown()).toEqual(conflict('b.txt'))
  })

  it('closes its own view once it is done', async () => {
    patchRepo('/game', { diff: { source: conflict('a.txt'), data: null } })
    const resolving = resolveWithContent('/game', 'a.txt', 'merged\n', 'original\n')
    await vi.waitFor(() => expect(stub.resolveConflictFile).toHaveBeenCalled())
    finishResolve()
    expect(await resolving).toBe(true)
    expect(shown()).toBeNull()
  })
})
