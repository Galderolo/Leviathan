import { describe, expect, it } from 'vitest'
import { unchangedGaps } from '../src/shared/diffGaps'
import { parseDiff } from '../src/shared/parsers'

const HEADER = 'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n'
const hunks = (body: string) => parseDiff(HEADER + body, 'f.txt').hunks
/** Context lines of the whole file from `from` to `to`, numbered `shift` further on the new side. */
const ctx = (from: number, to: number, shift = 0) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    type: 'ctx',
    oldNo: from + i,
    newNo: from + i + shift,
    text: `l${from + i}`
  }))
const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ` l${from + i}\n`).join('')

describe('unchangedGaps', () => {
  it('finds the unchanged lines between two hunks', () => {
    const diff = hunks('@@ -1,3 +1,3 @@\n l1\n-l2\n+L2\n l3\n@@ -10,3 +10,3 @@\n l10\n-l11\n+L11\n l12\n')
    const whole = hunks(`@@ -1,12 +1,12 @@\n l1\n-l2\n+L2\n${lines(3, 10)}-l11\n+L11\n l12\n`)
    expect(unchangedGaps(diff, whole)).toEqual([[], ctx(4, 9), []])
  })

  it('finds the unchanged lines before the first hunk and after the last', () => {
    const diff = hunks('@@ -5,3 +5,3 @@\n l5\n-l6\n+L6\n l7\n')
    const whole = hunks(`@@ -1,9 +1,9 @@\n${lines(1, 5)}-l6\n+L6\n${lines(7, 9)}`)
    expect(unchangedGaps(diff, whole)).toEqual([ctx(1, 4), ctx(8, 9)])
  })

  it('places the lines around hunks without context (diff.context = 0)', () => {
    // A line added after l3, and l3 then removed from another copy.
    const added = hunks('@@ -3,0 +4 @@\n+new\n')
    const addedWhole = hunks(`@@ -1,5 +1,6 @@\n${lines(1, 3)}+new\n${lines(4, 5)}`)
    expect(unchangedGaps(added, addedWhole)).toEqual([ctx(1, 3), ctx(4, 5, 1)])

    const removed = hunks('@@ -3 +2,0 @@\n-l3\n')
    const removedWhole = hunks(`@@ -1,5 +1,4 @@\n${lines(1, 2)}-l3\n${lines(4, 5)}`)
    expect(unchangedGaps(removed, removedWhole)).toEqual([ctx(1, 2), ctx(4, 5, -1)])
  })

  it('leaves out the note about a missing newline at the end', () => {
    const diff = hunks('@@ -1,2 +1,2 @@\n-l1\n+L1\n l2\n')
    const whole = hunks(`@@ -1,4 +1,4 @@\n-l1\n+L1\n${lines(2, 4)}\\ No newline at end of file\n`)
    expect(unchangedGaps(diff, whole)).toEqual([[], ctx(3, 4)])
  })

  it('has one empty gap when nothing changed', () => {
    expect(unchangedGaps([], [])).toEqual([[]])
  })
})
