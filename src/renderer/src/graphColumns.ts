import { graphContentWidth } from '../../shared/graph'
import { moveTab } from './tabOrder'

/** Widths of the commit graph's columns, in px; the message takes what is left. */
export interface GraphColumns {
  refs: number
  graph: number
  author: number
  date: number
  sha: number
}

/** Room for a branch name, and for about eight lanes before the graph scrolls sideways. */
export const DEFAULT_COLUMNS: GraphColumns = { refs: 200, graph: graphContentWidth(8), author: 150, date: 150, sha: 70 }

const LIMITS: Record<keyof GraphColumns, [number, number]> = {
  refs: [80, 480],
  graph: [48, 800],
  author: [60, 400],
  date: [80, 300],
  sha: [50, 200]
}
const KINDS = Object.keys(LIMITS) as (keyof GraphColumns)[]
/** The least the message keeps; past that, the columns scroll sideways. */
const MESSAGE_MIN = 140
const KEY = 'leviathan.graphColumns'

interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStore(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function clampWidth(kind: keyof GraphColumns, px: number): number {
  const [min, max] = LIMITS[kind]
  return Math.round(Math.min(max, Math.max(min, px)))
}

/** The widths the user dragged the columns to (the same in every repository), or the defaults. */
export function readGraphColumns(store = browserStore()): GraphColumns {
  try {
    const saved = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<GraphColumns> | null
    if (typeof saved?.refs === 'number' && typeof saved.graph === 'number') {
      // Author, date and SHA came later: widths saved before have none for them.
      const width = (kind: keyof GraphColumns) => {
        const px = saved[kind]
        return clampWidth(kind, typeof px === 'number' ? px : DEFAULT_COLUMNS[kind])
      }
      return {
        refs: width('refs'),
        graph: width('graph'),
        author: width('author'),
        date: width('date'),
        sha: width('sha')
      }
    }
  } catch {
    // unreadable: the defaults
  }
  return DEFAULT_COLUMNS
}

export function writeGraphColumns(columns: GraphColumns, store = browserStore()): void {
  try {
    store?.setItem(
      KEY,
      JSON.stringify(Object.fromEntries(KINDS.map((kind) => [kind, clampWidth(kind, columns[kind])])))
    )
  } catch {
    // not critical: the next start uses the defaults
  }
}

/** The graph's columns that can be hidden, in the order they are shown; branch, graph and message always are. */
export const OPTIONAL_COLUMNS = ['author', 'date', 'sha'] as const
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]

const HIDDEN_KEY = 'leviathan.graphHiddenColumns'
const ORDER_KEY = 'leviathan.graphColumnOrder'

/** The grid template of the graph's rows and header: the columns shown, in their order, at their widths. */
export function gridColumns(
  widths: GraphColumns,
  hidden: OptionalColumn[],
  order: readonly OptionalColumn[] = OPTIONAL_COLUMNS
): string {
  // Author, date and SHA take the width they were given while there is room, then narrow down to their minimum.
  const optional = order.filter((c) => !hidden.includes(c)).map((c) => `minmax(${LIMITS[c][0]}px, ${widths[c]}px)`)
  return [`${widths.refs}px`, `${widths.graph}px`, `minmax(${MESSAGE_MIN}px, 1fr)`, ...optional].join(' ')
}

/** How narrow the columns shown can get: below that, the graph scrolls sideways instead of cutting them off. */
export function gridMinWidth(
  widths: GraphColumns,
  hidden: OptionalColumn[],
  order: readonly OptionalColumn[] = OPTIONAL_COLUMNS
): number {
  const optional = order.filter((c) => !hidden.includes(c)).reduce((sum, c) => sum + LIMITS[c][0], 0)
  return widths.refs + widths.graph + MESSAGE_MIN + optional
}

/** The order the user dragged author, date and SHA to (the same in every repository), or the usual one. */
export function readColumnOrder(store = browserStore()): OptionalColumn[] {
  try {
    const saved = JSON.parse(store?.getItem(ORDER_KEY) ?? 'null') as unknown
    const complete =
      Array.isArray(saved) &&
      saved.length === OPTIONAL_COLUMNS.length &&
      OPTIONAL_COLUMNS.every((c) => saved.includes(c))
    if (complete) return saved as OptionalColumn[]
  } catch {
    // unreadable: the usual order
  }
  return [...OPTIONAL_COLUMNS]
}

export function writeColumnOrder(order: OptionalColumn[], store = browserStore()): void {
  try {
    store?.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    // not critical: the next start shows the usual order
  }
}

/**
 * `order` with `column` moved into gap `gap` of the columns shown (0 = before the first one shown); a hidden
 * column keeps its place, for when it is shown again.
 */
export function moveColumn(
  order: OptionalColumn[],
  hidden: OptionalColumn[],
  column: OptionalColumn,
  gap: number
): OptionalColumn[] {
  const shown = order.filter((c) => !hidden.includes(c))
  const moved = moveTab(
    shown.map((id) => ({ id })),
    column,
    gap
  ).map((c) => c.id as OptionalColumn)
  return order.map((c) => (hidden.includes(c) ? c : moved.shift()!))
}

/** The columns the user hid (the same in every repository), in the order they are shown. */
export function readHiddenColumns(store = browserStore()): OptionalColumn[] {
  try {
    const saved = JSON.parse(store?.getItem(HIDDEN_KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? OPTIONAL_COLUMNS.filter((c) => saved.includes(c)) : []
  } catch {
    return []
  }
}

export function writeHiddenColumns(hidden: OptionalColumn[], store = browserStore()): void {
  try {
    store?.setItem(HIDDEN_KEY, JSON.stringify(OPTIONAL_COLUMNS.filter((c) => hidden.includes(c))))
  } catch {
    // not critical: the next start shows every column
  }
}

/** How far the graph can scroll sideways: from 0 until its last lane reaches the column's edge. */
export function clampGraphScroll(offset: number, content: number, view: number): number {
  return Math.max(0, Math.min(offset, content - view))
}
