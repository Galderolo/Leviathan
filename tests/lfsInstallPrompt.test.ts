import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LfsInfo } from '../src/shared/lfs'
import { DEFAULT_SETTINGS } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
let lfsInfo: LfsInfo
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  getLfsInfo: vi.fn(async () => lfsInfo),
  installGitLfs: vi.fn(() => new Promise(() => {})),
  saveSettings: vi.fn(async () => DEFAULT_SETTINGS),
  openExternal: vi.fn(async () => {}),
  getLfsLocks: vi.fn(async () => ({ locks: [], verified: true }))
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
const writeText = vi.fn(async () => {})
vi.stubGlobal('navigator', { language: 'en', clipboard: { writeText } })

const { loadLfsInfo, recheckGitLfs, setActiveTab } = await import('../src/renderer/src/actions')
const { newRepoView, patchRepo, useStore } = await import('../src/renderer/src/store')

const missing: LfsInfo = {
  version: null,
  used: true,
  filters: false,
  hooks: false,
  patterns: [{ pattern: '*.psd', lockable: false, source: '.gitattributes' }]
}

/** Repositories open in tabs, the first one showing. Each test uses names of its own: questions are per session. */
function open(...paths: string[]) {
  useStore.setState({
    dialog: null,
    lfsOffer: { method: 'zip' },
    lfsInstalling: false,
    repos: Object.fromEntries(paths.map((p) => [p, newRepoView(p, 100)])),
    tabs: paths.map((p) => ({ id: p, path: p })),
    activeTab: paths[0]
  })
}

const dialog = () => useStore.getState().dialog

beforeEach(() => {
  lfsInfo = missing
  for (const fn of Object.values(stub)) fn.mockClear()
  writeText.mockClear()
})

describe('asking to install git-lfs', () => {
  it('asks once per repository per session', async () => {
    open('/a')
    await loadLfsInfo('/a')
    expect(dialog()?.title).toBe('Git LFS is not installed')
    dialog()!.resolve(null)
    await loadLfsInfo('/a')
    expect(dialog()).toBeNull()
  })

  it('asks only for the active tab, one question at a time', async () => {
    open('/c', '/d')
    await loadLfsInfo('/d')
    expect(dialog()).toBeNull()
    await loadLfsInfo('/c')
    await loadLfsInfo('/c')
    expect(dialog()?.message).toMatch(/^c keeps its large files/)
    dialog()!.resolve(null)
    expect(dialog()).toBeNull()
    // The answer settles before anyone can switch tabs.
    await new Promise((resolve) => setTimeout(resolve, 0))
    setActiveTab('/d')
    expect(dialog()?.message).toMatch(/^d keeps its large files/)
    dialog()!.resolve(null)
  })

  it('asks once "What\'s new" is closed, not on top of it', async () => {
    open('/w')
    useStore.setState({ whatsNewOpen: true })
    await loadLfsInfo('/w')
    expect(dialog()).toBeNull()
    useStore.setState({ whatsNewOpen: false })
    await vi.waitFor(() => expect(dialog()?.message).toMatch(/^w keeps its large files/))
    dialog()!.resolve(null)
  })

  it('installs when the question is accepted', async () => {
    open('/e')
    await loadLfsInfo('/e')
    expect(dialog()?.confirmText).toBe('Install git-lfs')
    dialog()!.resolve({})
    await vi.waitFor(() => expect(stub.installGitLfs).toHaveBeenCalledTimes(1))
    expect(stub.installGitLfs).toHaveBeenCalledWith('/e')
  })

  it('copies the command when the system needs it run by hand', async () => {
    open('/f')
    useStore.setState({ lfsOffer: { method: 'command', command: 'sudo apt-get install git-lfs' } })
    await loadLfsInfo('/f')
    expect(dialog()?.message).toContain('sudo apt-get install git-lfs')
    expect(dialog()?.confirmText).toBe('Copy command')
    dialog()!.resolve({})
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('sudo apt-get install git-lfs'))
    expect(stub.installGitLfs).not.toHaveBeenCalled()
  })
})

describe('git-lfs installed by hand', () => {
  it('notices git-lfs installed while the app runs and loads the locks', async () => {
    open('/g')
    useStore.setState({ lfsOffer: null })
    await loadLfsInfo('/g')
    patchRepo('/g', { state: { remotes: [{ name: 'origin', url: 'https://example.com/g.git' }] } as never })

    // Back to the window, git-lfs still missing: asked again, then not for a while.
    stub.getLfsInfo.mockClear()
    recheckGitLfs(100_000)
    await vi.waitFor(() => expect(stub.getLfsInfo).toHaveBeenCalledTimes(1))
    stub.getLfsInfo.mockClear()
    recheckGitLfs(105_000)
    expect(stub.getLfsInfo).not.toHaveBeenCalled()

    lfsInfo = { ...missing, version: '3.8.1', filters: true, hooks: true }
    recheckGitLfs(111_000)
    await vi.waitFor(() => expect(useStore.getState().repos['/g'].lfs?.info.version).toBe('3.8.1'))
    await vi.waitFor(() => expect(stub.getLfsLocks).toHaveBeenCalledTimes(1))
  })
})
