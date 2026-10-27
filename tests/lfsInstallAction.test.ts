import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LfsInfo } from '../src/shared/lfs'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
const infoCalls: string[] = []
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  installGitLfs: vi.fn(async () => '3.8.1'),
  setupLfs: vi.fn(async () => {}),
  getLfsInfo: vi.fn(async (path: string): Promise<LfsInfo> => {
    infoCalls.push(path)
    return { version: '3.8.1', used: true, filters: true, hooks: true, patterns: [] }
  })
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})

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
    stub.installGitLfs.mockRejectedValueOnce(new Error('boom'))
    expect(await installGitLfs('/a')).toBe(false)
    const [error] = toasts('error')
    expect(error).toContain('boom')
    expect(error).toContain('Get Git LFS')
    expect(stub.setupLfs).not.toHaveBeenCalled()
    expect(useStore.getState().lfsInstalling).toBe(false)
  })
})
