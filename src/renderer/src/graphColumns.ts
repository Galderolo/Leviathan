import { graphContentWidth } from '../../shared/graph'

/** Widths of the BRANCH / TAG and GRAPH columns of the commit graph, in px. */
export interface GraphColumns {
  refs: number
  graph: number
}

/** Room for a branch name, and for about eight lanes before the graph scrolls sideways. */
export const DEFAULT_COLUMNS: GraphColumns = { refs: 200, graph: graphContentWidth(8) }

const LIMITS: Record<keyof GraphColumns, [number, number]> = { refs: [80, 480], graph: [48, 800] }
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
      return { refs: clampWidth('refs', saved.refs), graph: clampWidth('graph', saved.graph) }
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
      JSON.stringify({ refs: clampWidth('refs', columns.refs), graph: clampWidth('graph', columns.graph) })
    )
  } catch {
    // not critical: the next start uses the defaults
  }
}

/** The graph's columns that can be hidden, in the order they are shown; branch, graph and message always are. */
export const OPTIONAL_COLUMNS = ['author', 'date', 'sha'] as const
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]

const OPTIONAL_WIDTHS: Record<OptionalColumn, string> = {
  author: 'minmax(90px, 150px)',
  date: 'minmax(110px, 150px)',
  sha: '70px'
}
const HIDDEN_KEY = 'leviathan.graphHiddenColumns'

/** The grid template of the graph's rows and header: the columns shown, at their widths. */
export function gridColumns(widths: GraphColumns, hidden: OptionalColumn[]): string {
  const optional = OPTIONAL_COLUMNS.filter((c) => !hidden.includes(c)).map((c) => OPTIONAL_WIDTHS[c])
  return [`${widths.refs}px`, `${widths.graph}px`, 'minmax(140px, 1fr)', ...optional].join(' ')
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
