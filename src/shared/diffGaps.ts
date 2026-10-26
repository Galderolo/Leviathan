import type { DiffHunk, DiffLine } from './types'

/**
 * The unchanged lines of a file around the hunks of its diff: one gap before each hunk and one after the last.
 * `whole` is the same diff with the whole file as context (`git diff -U<huge>`), so its lines read exactly like
 * the hunks' own (line endings, filters).
 */
export function unchangedGaps(hunks: DiffHunk[], whole: DiffHunk[]): DiffLine[][] {
  const gaps: DiffLine[][] = [...hunks.map(() => []), []]
  // Old lines each hunk covers, [start, end); one without old lines (no context) sits right after `oldStart`.
  const ranges = hunks.map((h) => {
    const start = h.oldLines ? h.oldStart : h.oldStart + 1
    return { start, end: start + h.oldLines }
  })
  let next = 0
  for (const line of whole.flatMap((h) => h.lines)) {
    if (line.type !== 'ctx' || line.oldNo === undefined) continue
    while (next < ranges.length && line.oldNo >= ranges[next].end) next++
    if (next < ranges.length && line.oldNo >= ranges[next].start) continue
    gaps[next].push(line)
  }
  return gaps
}
