import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type RepoState, type Settings } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
let saved: Settings = DEFAULT_SETTINGS
const repoState = (path: string) =>
  ({
    path,
    head: { branch: 'main', hash: 'h1', detached: false, upstream: 'origin/main', ahead: 0, behind: 0 },
    refs: [],
    stashes: [],
    remotes: [{ name: 'origin', fetchUrl: 'https://example.com/r.git', pushUrl: 'https://example.com/r.git' }],
    status: { staged: [], unstaged: [], conflicted: [] },
    operation: null,
    editing: null,
    unpushed: [],
    lfsFiles: [],
    largeFiles: []
  }) as unknown as RepoState
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  saveSettings: vi.fn(async (patch: Partial<Settings>) => (saved = { ...saved, ...patch })),
  getState: vi.fn(async (path: string) => repoState(path)),
  fetch: vi.fn(async () => {}),
  pull: vi.fn(async () => {}),
  push: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  openInEditor: vi.fn(async () => {}),
  openPath: vi.fn(async () => {})
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { autoFetchTick, commit, loadMore, openInEditor, pull, saveSettingFor } =
  await import('../src/renderer/src/actions')
const { getRepo, newRepoView, patchRepo, useStore } = await import('../src/renderer/src/store')

/** Repositories open in tabs, with these settings. */
function open(settings: Partial<Settings>, ...paths: string[]) {
  saved = { ...DEFAULT_SETTINGS, ...settings }
  useStore.setState({
    settings: saved,
    repos: Object.fromEntries(paths.map((p) => [p, { ...newRepoView(p, 100), state: repoState(p) }])),
    tabs: paths.map((p) => ({ id: p, path: p })),
    activeTab: paths[0]
  })
}

beforeEach(() => {
  for (const fn of Object.values(stub)) fn.mockClear()
})

describe('settings of a repository of its own', () => {
  it('fetches in the background each repository on its own interval', () => {
    open({ autoFetchMinutes: 0, repoSettings: { '/space': { autoFetchMinutes: 1 } } }, '/space', '/other')
    autoFetchTick()
    expect(stub.fetch.mock.calls).toEqual([['/space', true]])

    open({ autoFetchMinutes: 10, repoSettings: { '/quiet': { autoFetchMinutes: 0 } } }, '/quiet', '/busy')
    autoFetchTick()
    expect(stub.fetch.mock.calls.slice(1)).toEqual([['/busy', true]])
  })

  it('pulls with the mode of the repository', async () => {
    open({ pullMode: 'ff', repoSettings: { '/space': { pullMode: 'rebase' } } }, '/space', '/other')
    await pull('/space')
    await pull('/other')
    expect(stub.pull.mock.calls).toEqual([
      ['/space', 'rebase'],
      ['/other', 'ff']
    ])
  })

  it('keeps a pull mode picked from the Pull menu where the mode came from', async () => {
    open({ pullMode: 'ff', repoSettings: { '/space': { pullMode: 'rebase' } } }, '/space', '/other')
    await pull('/space', 'ff-only')
    expect(useStore.getState().settings).toMatchObject({
      pullMode: 'ff',
      repoSettings: { '/space': { pullMode: 'ff-only' } }
    })
    await pull('/other', 'rebase')
    expect(useStore.getState().settings).toMatchObject({
      pullMode: 'rebase',
      repoSettings: { '/space': { pullMode: 'ff-only' } }
    })
  })

  it('changes a setting from the repository where its value came from', async () => {
    open({ pushAfterCommit: false, repoSettings: { '/space': { pushAfterCommit: false } } }, '/space', '/other')
    await saveSettingFor('/space', 'pushAfterCommit', true)
    expect(useStore.getState().settings).toMatchObject({
      pushAfterCommit: false,
      repoSettings: { '/space': { pushAfterCommit: true } }
    })
    await saveSettingFor('/other', 'pushAfterCommit', true)
    expect(useStore.getState().settings).toMatchObject({
      pushAfterCommit: true,
      repoSettings: { '/space': { pushAfterCommit: true } }
    })
  })

  it('pushes right after a commit only in a repository that says so', async () => {
    open({ pushAfterCommit: false, repoSettings: { '/space': { pushAfterCommit: true } } }, '/space', '/other')
    for (const path of ['/space', '/other']) {
      patchRepo(path, (r) => ({ draft: { ...r.draft, summary: 'Change' } }))
      expect(await commit(path)).toBe(true)
    }
    expect(stub.commit).toHaveBeenCalledTimes(2)
    expect(stub.push.mock.calls.map((c) => c[0])).toEqual(['/space'])
  })

  it('loads more commits as many at a time as the repository says', async () => {
    open({ commitLimit: 2000, repoSettings: { '/space': { commitLimit: 500 } } }, '/space', '/other')
    for (const path of ['/space', '/other']) patchRepo(path, { hasMore: true, limit: 100 })
    await loadMore('/space')
    await loadMore('/other')
    expect(getRepo('/space')?.limit).toBe(600)
    expect(getRepo('/other')?.limit).toBe(2100)
  })

  it('opens the repository in its own editor', () => {
    open({ editor: '', repoSettings: { '/space': { editor: 'code {folder}' } } }, '/space', '/other')
    openInEditor('/space', null)
    openInEditor('/other', null)
    expect(stub.openInEditor.mock.calls).toEqual([['/space', null, undefined]])
    expect(stub.openPath.mock.calls).toEqual([['/other']])
  })
})
