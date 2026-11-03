import type { Segment } from '../../shared/conflicts'
import type { DiffHunk, DiffLine } from '../../shared/types'

/** What the conflict editor draws, in order. `from` / `to` index `hunk.lines` (`to` is past the last line). */
export type ConflictPart =
  | { kind: 'lines'; from: number; to: number }
  | { kind: 'fold'; id: number; from: number; to: number }
  | { kind: 'conflict'; index: number; ours: [number, number]; theirs: [number, number] }

export interface ConflictLayout {
  hunk: DiffHunk
  parts: ConflictPart[]
}

/**
 * A file in conflict as one diff hunk (its common lines as context, each conflict's current side as removed lines and
 * its incoming side as added ones, numbered as in each version), so it is highlighted and its changed words marked
 * as a diff is. Runs of common lines farther than `context` lines from any conflict fold away.
 */
export function conflictLayout(segments: Segment[], context = 3): ConflictLayout {
  const lines: DiffLine[] = []
  const parts: ConflictPart[] = []
  const anyConflict = segments.some((s) => s.kind === 'conflict')
  let ours = 1
  let theirs = 1
  let conflicts = 0
  let folds = 0
  const text = (line: string) => line.replace(/\r?\n$/, '')

  segments.forEach((segment, i) => {
    const from = lines.length
    if (segment.kind === 'conflict') {
      for (const line of segment.ours) lines.push({ type: 'del', oldNo: ours++, text: text(line) })
      const middle = lines.length
      for (const line of segment.theirs) lines.push({ type: 'add', newNo: theirs++, text: text(line) })
      parts.push({ kind: 'conflict', index: conflicts++, ours: [from, middle], theirs: [middle, lines.length] })
      return
    }
    for (const line of segment.lines) lines.push({ type: 'ctx', oldNo: ours++, newNo: theirs++, text: text(line) })
    const to = lines.length
    // Kept: the lines next to a conflict before or after.
    const head = anyConflict && segments.slice(0, i).some((s) => s.kind === 'conflict') ? context : 0
    const tail = anyConflict && segments.slice(i + 1).some((s) => s.kind === 'conflict') ? context : 0
    if (!anyConflict || to - from - head - tail < 2) {
      parts.push({ kind: 'lines', from, to })
      return
    }
    if (head) parts.push({ kind: 'lines', from, to: from + head })
    parts.push({ kind: 'fold', id: folds++, from: from + head, to: to - tail })
    if (tail) parts.push({ kind: 'lines', from: to - tail, to })
  })

  const hunk: DiffHunk = {
    header: '',
    oldStart: 1,
    oldLines: ours - 1,
    newStart: 1,
    newLines: theirs - 1,
    lines,
    patch: ''
  }
  return { hunk, parts }
}
