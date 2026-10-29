import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckoutBlock } from '../src/shared/checkout'
import { DEFAULT_SETTINGS, type GitRef, type RepoState } from '../src/shared/types'

// The renderer reads its API from the preload bridge; what this test does not need fails at once.
let stashes: { index: number; hash: string; message: string }[] = []
let conflicted: { path: string; status: string }[] = []
const block: CheckoutBlock = {
  message: 'error: Your local changes to the following files would be overwritten by checkout:',
  changed: ['a.txt'],
  untracked: ['new.txt'],
  folders: []
}
const state = () =>
  ({
    head: { branch: 'main', hash: 'h1', detached: false, upstream: null, ahead: 0, behind: 0 },
    refs: [],
    stashes,
    remotes: [],
    status: {
      staged: [{ path: 'a.txt', status: 'M' }],
      unstaged: [{ path: 'new.txt', status: '?' }],
      conflicted
    },
    operation: null,
    unpushed: []
  }) as unknown as RepoState
const stub: Record<string, ReturnType<typeof vi.fn>> = {
  getState: vi.fn(async () => state()),
  checkout: vi.fn(),
  merge: vi.fn(async () => {}),
  stashSave: vi.fn(async () => {
    stashes = [{ index: 0, hash: 'new', message: 'WIP on main' }, ...stashes.map((s) => ({ ...s, index: s.index + 1 }))]
  }),
  stashPop: vi.fn(async () => {}),
  stashTrackedClashes: vi.fn(async () => []),
  stashUntrackedClashes: vi.fn(async () => []),
  stashPaths: vi.fn(async () => []),
  restoreFromHead: vi.fn(async () => {})
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})
vi.stubGlobal('navigator', { language: 'en' })

const { checkoutAndMerge, checkoutRef } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

const other = { name: 'other', type: 'head', hash: 'h2' } as GitRef

/** Waits for the dialog and answers it: a button's key, `{}` to confirm, or null to cancel. */
async function answer(choice: string | Record<string, string> | null) {
  await vi.waitFor(() => expect(useStore.getState().dialog).not.toBeNull())
  const dialog = useStore.getState().dialog!
  dialog.resolve(typeof choice === 'string' ? { choice } : choice)
  return dialog
}

beforeEach(() => {
  for (const fn of Object.values(stub)) fn.mockClear()
  stub.checkout.mockReset()
  stashes = [{ index: 0, hash: 'old', message: 'earlier' }]
  conflicted = []
  useStore.setState({
    settings: DEFAULT_SETTINGS,
    repos: { '/r': { ...newRepoView('/r', 100), state: state() } },
    tabs: [{ id: '/r', path: '/r' }],
    activeTab: '/r',
    dialog: null,
    toasts: []
  })
})

describe('a checkout with uncommitted changes in its way', () => {
  it('asks nothing when the checkout goes through', async () => {
    stub.checkout.mockResolvedValue(null)
    expect(await checkoutRef('/r', other)).toBe(true)
    expect(useStore.getState().dialog).toBeNull()
  })

  it('names the files and offers to stash, take along or discard them', async () => {
    stub.checkout.mockResolvedValueOnce(block).mockResolvedValueOnce(null)
    const going = checkoutRef('/r', other)
    const dialog = await answer('stash')

    expect(dialog.list).toEqual(['a.txt', 'new.txt'])
    expect(dialog.choices?.map((c) => [c.key, !!c.primary, !!c.danger])).toEqual([
      ['discard', false, true],
      ['carry', false, false],
      ['stash', true, false]
    ])
    expect(await going).toBe(true)
    expect(stub.stashSave).toHaveBeenCalledWith('/r', null)
    expect(stub.checkout).toHaveBeenCalledTimes(2)
    expect(stub.stashPop).not.toHaveBeenCalled()
  })

  it('takes them along: the new stash is popped after the checkout', async () => {
    stub.checkout.mockResolvedValueOnce(block).mockResolvedValueOnce(null)
    const going = checkoutRef('/r', other)
    await answer('carry')

    expect(await going).toBe(true)
    expect(stub.stashPop).toHaveBeenCalledWith('/r', 0, 'new')
    expect(stub.stashSave.mock.invocationCallOrder[0]).toBeLessThan(stub.checkout.mock.invocationCallOrder[1])
    expect(stub.checkout.mock.invocationCallOrder[1]).toBeLessThan(stub.stashPop.mock.invocationCallOrder[0])
  })

  it('says so when the changes taken along clash with the branch', async () => {
    stub.checkout.mockResolvedValueOnce(block).mockResolvedValueOnce(null)
    stub.stashPop.mockImplementationOnce(async () => {
      conflicted = [{ path: 'a.txt', status: 'U' }]
      throw new Error('CONFLICT (content): Merge conflict in a.txt')
    })
    const going = checkoutRef('/r', other)
    await answer('carry')

    expect(await going).toBe(true)
    const texts = useStore.getState().toasts.map((t) => [t.kind, t.text])
    expect(texts).toContainEqual(['info', expect.stringContaining('The stash clashes')])
    expect(texts).not.toContainEqual(['error', expect.stringContaining('CONFLICT')])
  })

  it('discards only the files in the way', async () => {
    stub.checkout.mockResolvedValueOnce(block).mockResolvedValueOnce(null)
    const going = checkoutRef('/r', other)
    await answer('discard')

    expect(await going).toBe(true)
    expect(stub.restoreFromHead).toHaveBeenCalledWith('/r', ['a.txt'], ['new.txt'])
    expect(stub.stashSave).not.toHaveBeenCalled()
  })

  it('offers no discard when untracked files of a folder are in the way', async () => {
    stub.checkout.mockResolvedValueOnce({ ...block, changed: [], untracked: [], folders: ['d'] })
    const going = checkoutRef('/r', other)
    const dialog = await answer(null)

    expect(dialog.list).toEqual(['d/'])
    expect(dialog.choices?.map((c) => c.key)).toEqual(['carry', 'stash'])
    expect(await going).toBe(false)
  })

  it('leaves everything as it was when cancelled', async () => {
    stub.checkout.mockResolvedValueOnce(block)
    const going = checkoutRef('/r', other)
    await answer(null)

    expect(await going).toBe(false)
    expect(stub.checkout).toHaveBeenCalledTimes(1)
    expect(stub.stashSave).not.toHaveBeenCalled()
    expect(stub.restoreFromHead).not.toHaveBeenCalled()
  })

  it('says why when the second checkout is stopped too', async () => {
    stub.checkout.mockResolvedValue(block)
    const going = checkoutRef('/r', other)
    await answer('stash')

    expect(await going).toBe(false)
    expect(useStore.getState().toasts.map((t) => [t.kind, t.text])).toContainEqual(['error', block.message])
  })

  it('does not merge into the branch it is still on', async () => {
    stub.checkout.mockResolvedValueOnce(block)
    const going = checkoutAndMerge('/r', 'other', 'feature')
    await answer({})

    expect(await going).toBe(false)
    expect(stub.merge).not.toHaveBeenCalled()
  })
})
