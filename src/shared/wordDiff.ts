import type { DiffLine } from './types'

/** A piece of a line, and whether it differs from the other side. */
export interface Span {
  text: string
  changed: boolean
}

/** Words (in any alphabet), runs of spaces and single punctuation marks. */
export function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []
}

const MAX_CELLS = 250_000
const MIN_SHARED = 0.3

/**
 * Which words changed between an old and a new version of a line, for
 * highlighting inside the line. Null when the lines are too long to compare
 * quickly, or share too little for the highlight to mean anything.
 */
export function wordDiff(oldText: string, newText: string): { old: Span[]; new: Span[] } | null {
  const a = tokenize(oldText)
  const b = tokenize(newText)
  if (!a.length || !b.length || a.length * b.length > MAX_CELLS) return null
  // Longest common subsequence of tokens.
  const width = b.length + 1
  const table = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const keepA = new Array<boolean>(a.length).fill(false)
  const keepB = new Array<boolean>(b.length).fill(false)
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      keepA[i++] = true
      keepB[j++] = true
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
    else j++
  }
  const solid = (tokens: string[], keep: boolean[], only: boolean) =>
    tokens.reduce((n, t, k) => (/\S/.test(t) && (!only || keep[k]) ? n + t.length : n), 0)
  const shared = solid(a, keepA, true)
  if (shared < MIN_SHARED * Math.max(solid(a, keepA, false), solid(b, keepB, false))) return null
  return { old: spans(a, keepA), new: spans(b, keepB) }
}

/** Joins tokens into spans; spaces between two changed words count as changed, so the change reads as one. */
function spans(tokens: string[], keep: boolean[]): Span[] {
  const changed = tokens.map((t, k) => {
    if (!keep[k]) return true
    return /^\s+$/.test(t) && k > 0 && k < tokens.length - 1 && !keep[k - 1] && !keep[k + 1]
  })
  const out: Span[] = []
  tokens.forEach((text, k) => {
    const last = out[out.length - 1]
    if (last && last.changed === changed[k]) last.text += text
    else out.push({ text, changed: changed[k] })
  })
  return out
}

/** Within each change of a hunk, the k-th deleted line paired with the k-th added one (both ways). */
export function pairChanges(lines: DiffLine[]): Map<number, number> {
  const pairs = new Map<number, number>()
  let dels: number[] = []
  let adds: number[] = []
  const flush = () => {
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      pairs.set(dels[k], adds[k])
      pairs.set(adds[k], dels[k])
    }
    dels = []
    adds = []
  }
  lines.forEach((line, i) => {
    if (line.type === 'del') {
      if (adds.length) flush()
      dels.push(i)
    } else if (line.type === 'add') adds.push(i)
    else if (line.type === 'ctx') flush()
  })
  flush()
  return pairs
}

/** Rows of a side-by-side diff: indexes into `lines` for the old (left) and new (right) side. */
export function splitRows(lines: DiffLine[]): { left: number | null; right: number | null }[] {
  const rows: { left: number | null; right: number | null }[] = []
  let dels: number[] = []
  let adds: number[] = []
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
    dels = []
    adds = []
  }
  lines.forEach((line, i) => {
    if (line.type === 'del') {
      if (adds.length) flush()
      dels.push(i)
    } else if (line.type === 'add') adds.push(i)
    else if (line.type === 'meta' && lines[i - 1]?.type === 'del' && !adds.length) dels.push(i)
    else if (line.type === 'meta' && lines[i - 1]?.type === 'add') adds.push(i)
    else {
      flush()
      rows.push({ left: i, right: i })
    }
  })
  flush()
  return rows
}
