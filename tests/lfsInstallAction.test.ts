import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LfsInfo } from '../src/shared/lfs'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
const infoCalls: string[] = []
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  installGitLfs: vi.fn(async () => '3.8.1'),
  setupLfs: vi.fn(async () => ({ hooksToMerge: null })),
  getLfsInfo: vi.fn(async (path: string): Promise<LfsInfo> => {
    infoCalls.push(path)
    return { version: '3.8.1', used: true, filters: true, hooks: true, patterns: [] }
  }),
  getLfsInstallOffer: vi.fn(async () => ({ method: 'zip' })),
  // Closing a tab stops watching it and saves the tabs left.
  unwatchRepo: vi.fn(async () => {}),
  saveSettings: vi.fn(async () => useStore.getState().settings)
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
const writeText = vi.fn(async () => {})
vi.stubGlobal('navigator', { language: 'en', clipboard: { writeText } })

const { closeTab, copyLfsCommand, installGitLfs } = await import('../src/renderer/src/actions')
const { newRepoView, patchRepo, useStore } = await import('../src/renderer/src/store')

const toasts = (kind: string) =>
  useStore
    .getState()
    .toasts.filter((x) => x.kind === kind)
    .map((x) => x.text)

beforeEach(() => {
  infoCalls.length = 0
  for (const fn of Object.values(stub)) fn.mockClear()
  useStore.setState({
    toasts: [],
    repos: { '/a': newRepoView('/a', 100), '/b': newRepoView('/b', 100) },
    tabs: [
      { id: '/a', path: '/a' },
      { id: '/b', path: '/b' }
    ],
    activeTab: '/a'
  })
})

describe('installGitLfs', () => {
  it("installs, sets the repository up and reads every open repository's LFS info again", async () => {
    expect(await installGitLfs('/a')).toBe(true)
    expect(stub.setupLfs.mock.calls).toEqual([['/a']])
    expect(infoCalls.sort()).toEqual(['/a', '/b'])
    expect(toasts('success').some((text) => text.includes('3.8.1'))).toBe(true)
    expect(useStore.getState().lfsInstalling).toBe(false)
  })

  it('says why and how to get it by hand when the install fails', async () => {
    stub.installGitLfs.mockRejectedValueOnce(new Error('boom: nothing was installed.'))
    expect(await installGitLfs('/a')).toBe(false)
    const [error] = toasts('error')
    expect(error).toContain('boom: nothing was installed. "')
    expect(error).toContain('Get Git LFS')
    expect(stub.setupLfs).not.toHaveBeenCalled()
    expect(useStore.getState().lfsInstalling).toBe(false)
  })
})

describe('setting LFS up beside hooks of another tool', () => {
  it("says the hooks need git-lfs's lines, and copies its instructions", async () => {
    const hooksToMerge = 'Add the following to \'.git/hooks/pre-push\':\n\n\tgit lfs pre-push "$@"'
    stub.setupLfs.mockResolvedValueOnce({ hooksToMerge })
    expect(await installGitLfs('/a')).toBe(true)
    expect(toasts('success')).not.toContain('Git LFS is ready')
    const dialog = useStore.getState().dialog
    expect(dialog?.message).toContain('push does not upload the large files')
    expect(dialog?.confirmText).toBe('Copy the instructions')
    dialog!.resolve({})
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(hooksToMerge))
  })

  it('says it is ready when every hook is set up', async () => {
    stub.setupLfs.mockResolvedValueOnce({ hooksToMerge: null })
    expect(await installGitLfs('/a')).toBe(true)
    expect(toasts('success')).toContain('Git LFS is ready')
    expect(useStore.getState().dialog).toBeNull()
  })
})

describe('installGitLfs where the password cannot be asked for', () => {
  it('shows the command to copy instead of an error', async () => {
    const command = 'sudo apt-get install git-lfs'
    stub.installGitLfs.mockRejectedValueOnce(
      new Error(`Could not ask for your password: run "${command}" in a terminal.`)
    )
    stub.getLfsInstallOffer.mockResolvedValueOnce({ method: 'command', command })
    expect(await installGitLfs('/a')).toBe(false)
    expect(toasts('error')).toEqual([])
    expect(useStore.getState().lfsOffer).toEqual({ method: 'command', command })
    const dialog = useStore.getState().dialog
    expect(dialog?.message).toContain(command)
    expect(dialog?.confirmText).toBe('Copy command')
    dialog!.resolve({})
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(command))
  })
})

describe('installing git-lfs and what else goes on', () => {
  it('does not start while the repository is busy with something else', async () => {
    patchRepo('/a', { busy: 'pull' })
    expect(await installGitLfs('/a')).toBe(false)
    expect(stub.installGitLfs).not.toHaveBeenCalled()
    expect(toasts('info')).toEqual([expect.stringContaining('git-lfs')])
    expect(useStore.getState().repos['/a'].busy).toBe('pull')
  })

  it('asks before closing the tab it is installing from', async () => {
    let finish: (v: string) => void = () => {}
    stub.installGitLfs.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)))
    const installing = installGitLfs('/a')
    await vi.waitFor(() => expect(stub.installGitLfs).toHaveBeenCalled())
    closeTab('/a')
    await vi.waitFor(() => expect(useStore.getState().dialog?.message).toContain('git-lfs'))
    useStore.getState().dialog!.resolve(null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useStore.getState().tabs.map((tab) => tab.id)).toContain('/a')
    closeTab('/b')
    expect(useStore.getState().tabs.map((tab) => tab.id)).not.toContain('/b')
    finish('3.8.1')
    await installing
  })

  it('copies the command that installs it where the app cannot, also after the question was turned down', async () => {
    const command = 'sudo apt-get install git-lfs'
    useStore.setState({ lfsOffer: { method: 'command', command } })
    await copyLfsCommand()
    expect(writeText).toHaveBeenCalledWith(command)
  })
})
