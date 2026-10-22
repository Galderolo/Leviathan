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

/** How far the graph can scroll sideways: from 0 until its last lane reaches the column's edge. */
export function clampGraphScroll(offset: number, content: number, view: number): number {
  return Math.max(0, Math.min(offset, content - view))
}
