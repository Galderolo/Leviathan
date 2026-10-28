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
  getLfsInstallOffer: vi.fn(async () => ({ method: 'zip' }))
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
const writeText = vi.fn(async () => {})
vi.stubGlobal('navigator', { language: 'en', clipboard: { writeText } })

const { installGitLfs } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

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
