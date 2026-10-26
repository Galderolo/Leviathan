import { describe, expect, it } from 'vitest'
import { followDiff } from '../src/renderer/src/diffFollow'
import type { FileChange, WorkingStatus } from '../src/shared/types'

const file = (path: string, status = 'M'): FileChange => ({ path, status }) as FileChange
const status = (s: Partial<WorkingStatus>): WorkingStatus => ({ staged: [], unstaged: [], conflicted: [], ...s })

describe('followDiff', () => {
  it('keeps the diff while its file is still in its list', () => {
    const source = { kind: 'unstaged' as const, path: 'a.txt' }
    expect(followDiff(source, status({ unstaged: [file('a.txt')], staged: [file('a.txt')] }))).toBe(source)
  })

  it('follows a file staged or unstaged as a whole', () => {
    expect(followDiff({ kind: 'unstaged', path: 'a.txt' }, status({ staged: [file('a.txt')] }))).toEqual({
      kind: 'staged',
      path: 'a.txt'
    })
    expect(followDiff({ kind: 'staged', path: 'n.txt' }, status({ unstaged: [file('n.txt', '?')] }))).toEqual({
      kind: 'unstaged',
      path: 'n.txt',
      untracked: true
    })
  })

  it('closes when the file has no changes left', () => {
    expect(followDiff({ kind: 'unstaged', path: 'a.txt' }, status({ unstaged: [file('b.txt')] }))).toBeNull()
  })

  it('leaves commit diffs and conflicted files alone', () => {
    const commit = { kind: 'commit' as const, hash: 'h', parent: null, path: 'a.txt' }
    expect(followDiff(commit, status({}))).toBe(commit)
    const conflicted = { kind: 'unstaged' as const, path: 'c.txt', conflicted: true }
    expect(followDiff(conflicted, status({ conflicted: [file('c.txt', 'U')] }))).toBe(conflicted)
  })

  it('leaves the conflict editor once the file is no longer in conflict', () => {
    const conflicted = { kind: 'unstaged' as const, path: 'c.txt', conflicted: true }
    // Marked resolved from the list: the staged result.
    expect(followDiff(conflicted, status({ staged: [file('c.txt')] }))).toEqual({ kind: 'staged', path: 'c.txt' })
    // Resolved in an editor and not staged yet: the change in the working tree.
    expect(followDiff(conflicted, status({ unstaged: [file('c.txt')] }))).toEqual({ kind: 'unstaged', path: 'c.txt' })
    // The merge was aborted: nothing left to show.
    expect(followDiff(conflicted, status({}))).toBeNull()
  })
})
