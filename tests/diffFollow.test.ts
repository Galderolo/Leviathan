import { describe, expect, it } from 'vitest'
import { followDiff, sameDiff } from '../src/renderer/src/diffFollow'
import type { FileChange, FileDiff, WorkingStatus } from '../src/shared/types'

describe('sameDiff', () => {
  const diff = (text: string): FileDiff => ({
    path: 'a.txt',
    binary: false,
    header: 'diff --git a/a.txt b/a.txt',
    hunks: [
      {
        header: '@@ -0,0 +1 @@',
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [{ type: 'add', newNo: 1, text }],
        patch: `@@ -0,0 +1 @@\n+${text}\n`
      }
    ]
  })

  it('tells a diff read again unchanged from one whose file changed', () => {
    expect(sameDiff(diff('two'), diff('two'))).toBe(true)
    expect(sameDiff(diff('two'), diff('TWO'))).toBe(false)
    expect(sameDiff(null, diff('two'))).toBe(false)
    expect(sameDiff(diff('two'), null)).toBe(false)
  })
})

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

  it('follows a file that stays in the list but is untracked now, or tracked again', () => {
    // `git rm --cached a.txt`: still unstaged, as a new file.
    const untracked = { kind: 'unstaged' as const, path: 'a.txt', untracked: true }
    expect(
      followDiff(
        { kind: 'unstaged', path: 'a.txt' },
        status({ unstaged: [file('a.txt', '?')], staged: [file('a.txt', 'D')] })
      )
    ).toEqual(untracked)
    expect(followDiff(untracked, status({ unstaged: [file('a.txt')] }))).toEqual({ kind: 'unstaged', path: 'a.txt' })
    expect(followDiff(untracked, status({ unstaged: [file('a.txt', '?')] }))).toBe(untracked)
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
