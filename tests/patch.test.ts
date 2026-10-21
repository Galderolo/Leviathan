import { describe, expect, it } from 'vitest'
import { parseDiff } from '../src/shared/parsers'
import { buildPartialPatch, supportsLineSelection } from '../src/shared/patch'

const HEADER = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n'

function hunkOf(body: string[]) {
  const diff = parseDiff(HEADER + body.join('\n') + '\n', 'f')
  return { diff, hunk: diff.hunks[0] }
}

// 0: ' a'  1: '-b'  2: '+B'  3: '-c'  4: '+C'  5: ' d'
const SAMPLE = ['@@ -1,4 +1,4 @@', ' a', '-b', '+B', '-c', '+C', ' d']

describe('buildPartialPatch', () => {
  it('stages only the selected pair of lines', () => {
    const { diff, hunk } = hunkOf(SAMPLE)
    expect(buildPartialPatch(diff.header, hunk, new Set([1, 2]), false)).toBe(
      HEADER + ['@@ -1,4 +1,4 @@', ' a', '-b', '+B', ' c', ' d', ''].join('\n')
    )
  })

  it('turns unselected deletions into context and drops unselected additions when staging', () => {
    const { diff, hunk } = hunkOf(SAMPLE)
    expect(buildPartialPatch(diff.header, hunk, new Set([2]), false)).toBe(
      HEADER + ['@@ -1,4 +1,5 @@', ' a', ' b', '+B', ' c', ' d', ''].join('\n')
    )
  })

  it('keeps unselected additions as context and drops unselected deletions when unstaging', () => {
    const { diff, hunk } = hunkOf(SAMPLE)
    expect(buildPartialPatch(diff.header, hunk, new Set([3, 4]), true)).toBe(
      HEADER + ['@@ -1,4 +1,4 @@', ' a', ' B', '-c', '+C', ' d', ''].join('\n')
    )
  })

  // Old last line "b" had no newline; the change adds one and appends "c".
  const NO_NEWLINE = [
    '@@ -1,2 +1,3 @@',
    ' a',
    '-b',
    '\\ No newline at end of file',
    '+b',
    '+c',
    '\\ No newline at end of file'
  ]

  it('refuses a partial selection in hunks that change the final newline', () => {
    const { diff, hunk } = hunkOf(NO_NEWLINE)
    expect(supportsLineSelection(hunk)).toBe(false)
    // Staging only "+c" would turn "-b" into context without a newline: the index would become "a\nbc".
    expect(buildPartialPatch(diff.header, hunk, new Set([4]), false)).toBeNull()
    expect(buildPartialPatch(diff.header, hunk, new Set([4]), true)).toBeNull()
  })

  it('still stages such hunks when every changed line is selected', () => {
    const { diff, hunk } = hunkOf(NO_NEWLINE)
    expect(buildPartialPatch(diff.header, hunk, new Set([1, 3, 4]), false)).toBe(diff.header + hunk.patch)
  })

  it('allows line selection in ordinary hunks', () => {
    expect(supportsLineSelection(hunkOf(SAMPLE).hunk)).toBe(true)
  })

  it('preserves carriage returns of CRLF files', () => {
    const { diff, hunk } = hunkOf(['@@ -1,2 +1,2 @@', ' a\r', '-b\r', '+B\r'])
    expect(buildPartialPatch(diff.header, hunk, new Set([1, 2]), false)).toBe(
      HEADER + ['@@ -1,2 +1,2 @@', ' a\r', '-b\r', '+B\r', ''].join('\n')
    )
  })

  it('returns null when no change line is selected', () => {
    const { diff, hunk } = hunkOf(SAMPLE)
    expect(buildPartialPatch(diff.header, hunk, new Set([0, 5]), false)).toBeNull()
  })
})
