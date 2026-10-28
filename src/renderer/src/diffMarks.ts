export type ChangeKind = 'add' | 'del'

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
 * follow one another make one mark. Deletions come before additions at the same place.
 */
export function changeMarks(lines: ChangedLine[], total: number): ChangeMark[] {
  if (total <= 0) return []
  const ranges: { kind: ChangeKind; top: number; bottom: number }[] = []
  for (const kind of ['del', 'add'] as const) {
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
    .sort((a, b) => a.top - b.top || (a.kind === b.kind ? 0 : a.kind === 'del' ? -1 : 1))
    .map((r) => ({ kind: r.kind, top: r.top / total, height: (r.bottom - r.top) / total }))
}
