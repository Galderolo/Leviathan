import { describe, expect, it, vi } from 'vitest'
import { gitLfsFinder } from '../src/main/git/lfs'

describe('finding git-lfs', () => {
  it('finds git-lfs once for callers that ask at the same time, where its installer put it', async () => {
    // Off the PATH until its folder is added (Homebrew for an app opened from the Finder, a per-user install).
    let onPath = false
    const ask = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return onPath ? '3.8.1' : null
    })
    const add = vi.fn(() => {
      onPath = true
      return true
    })
    const find = gitLfsFinder(ask, async () => '/opt/homebrew/bin/git-lfs', add)
    expect(await Promise.all([find(), find(), find()])).toEqual(['3.8.1', '3.8.1', '3.8.1'])
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('/opt/homebrew/bin')
    expect(await find()).toBe('3.8.1')
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('looks again later while git-lfs is missing', async () => {
    let installed = false
    const find = gitLfsFinder(
      async () => (installed ? '3.8.1' : null),
      async () => null,
      () => false
    )
    expect(await find()).toBeNull()
    installed = true
    expect(await find()).toBe('3.8.1')
  })
})
