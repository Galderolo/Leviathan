/** A diff's changes (deleted, added), or a conflict editor's blocks (not resolved yet, resolved). */
export type ChangeKind = 'add' | 'del' | 'open' | 'resolved'

/** A changed line as drawn: its kind, and where it is in the diff's whole height (px). */
export interface ChangedLine {
  kind: ChangeKind
  top: number
  height: number
}

/** A mark beside the diff's scrollbar: where a change is, as shares (0–1) of the diff's whole height. */
export interface ChangeMark {
  kind: ChangeKind
  top: number
  height: number
}

/**
 * The marks for the changes of a diff `total` px high, as VS Code shows them by its scrollbar: lines of one kind that
 * follow one another make one mark. At the same place, the kinds come in the order of `kinds` (deletions before
 * additions).
 */
export function changeMarks(lines: ChangedLine[], total: number, kinds: ChangeKind[] = ['del', 'add']): ChangeMark[] {
  if (total <= 0) return []
  const ranges: { kind: ChangeKind; top: number; bottom: number }[] = []
  for (const kind of kinds) {
    let current: { kind: ChangeKind; top: number; bottom: number } | null = null
    for (const line of lines.filter((l) => l.kind === kind).sort((a, b) => a.top - b.top)) {
      if (current && line.top <= current.bottom + 1) current.bottom = Math.max(current.bottom, line.top + line.height)
      else {
        current = { kind, top: line.top, bottom: line.top + line.height }
        ranges.push(current)
      }
    }
  }
  return ranges
    .sort((a, b) => a.top - b.top || kinds.indexOf(a.kind) - kinds.indexOf(b.kind))
    .map((r) => ({ kind: r.kind, top: r.top / total, height: (r.bottom - r.top) / total }))
}
