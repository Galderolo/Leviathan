import type { Commit, Stash } from './types'

/** Number of distinct lane colours; the renderer maps `color % LANE_COLOR_COUNT` to a palette. */
export const LANE_COLOR_COUNT = 10

export interface GraphNodeInput {
  hash: string
  parents: string[]
  /** Draw this node's outgoing edges dashed (WIP and stash nodes). */
  dashed?: boolean
}

/**
 * A line segment inside one row.
 * - `full`: vertical pass-through from top to bottom at column `from` (== `to`).
 * - `top`: from column `from` at the top edge to column `to` at the row's centre (into the node).
 * - `bottom`: from column `from` at the centre (out of the node) to column `to` at the bottom edge.
 */
export interface GraphLine {
  from: number
  to: number
  kind: 'full' | 'top' | 'bottom'
  color: number
  dashed: boolean
}

export interface GraphRow {
  column: number
  color: number
  lines: GraphLine[]
  /** Number of columns this row needs to draw. */
  width: number
}

export interface GraphLayout {
  rows: GraphRow[]
  maxWidth: number
}

function firstFree(lanes: (string | null)[]): number {
  const idx = lanes.indexOf(null)
  return idx === -1 ? lanes.length : idx
}

/**
 * Assigns each commit a column ("lane") and computes the edges to draw.
 * Input must be ordered children-before-parents (e.g. `git log --date-order`).
 * Lanes never shift sideways, so pass-through lines are always vertical.
 */
export function computeGraph(nodes: GraphNodeInput[]): GraphLayout {
  const lanes: (string | null)[] = []
  const laneColor: number[] = []
  const laneDashed: boolean[] = []
  let nextColor = 0
  let maxWidth = 0
  const rows: GraphRow[] = []

  for (const node of nodes) {
    const lines: GraphLine[] = []
    let column = lanes.indexOf(node.hash)
    const isNewLane = column === -1
    if (isNewLane) {
      column = firstFree(lanes)
      lanes[column] = node.hash
      laneColor[column] = nextColor++ % LANE_COLOR_COUNT
      laneDashed[column] = false
    }
    const color = laneColor[column]
    const widthBefore = lanes.length

    // Top half: lanes flowing into this node, everything else passes through.
    for (let j = 0; j < lanes.length; j++) {
      const expected = lanes[j]
      if (expected === null) continue
      if (j === column && isNewLane) continue
      if (expected === node.hash) {
        lines.push({ from: j, to: column, kind: 'top', color: laneColor[j], dashed: laneDashed[j] })
        if (j !== column) lanes[j] = null
      } else {
        lines.push({ from: j, to: j, kind: 'full', color: laneColor[j], dashed: laneDashed[j] })
      }
    }

    // Bottom half: edges to parents.
    const dashed = !!node.dashed
    if (node.parents.length === 0) {
      lanes[column] = null
    } else {
      lanes[column] = node.parents[0]
      laneDashed[column] = dashed
      lines.push({ from: column, to: column, kind: 'bottom', color, dashed })
      for (const parent of node.parents.slice(1)) {
        let target = lanes.indexOf(parent)
        if (target === -1) {
          target = firstFree(lanes)
          lanes[target] = parent
          laneColor[target] = nextColor++ % LANE_COLOR_COUNT
          laneDashed[target] = dashed
        }
        lines.push({ from: column, to: target, kind: 'bottom', color: laneColor[target], dashed })
      }
    }

    const width = Math.max(widthBefore, lanes.length, column + 1)
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    maxWidth = Math.max(maxWidth, width)
    rows.push({ column, color, lines, width })
  }

  return { rows, maxWidth }
}

export type GraphItem =
  | { kind: 'wip'; hash: string; parents: string[] }
  | { kind: 'commit'; hash: string; parents: string[]; commit: Commit }
  | { kind: 'stash'; hash: string; parents: string[]; stash: Stash }

export const WIP_HASH = '__WIP__'

/**
 * Merges commits, stashes and the working-directory pseudo-commit into the
 * ordered list the graph is drawn from.
 */
export function buildGraphItems(
  commits: Commit[],
  stashes: Stash[],
  headHash: string | null,
  showWip: boolean
): GraphItem[] {
  const items: GraphItem[] = commits.map((commit) => ({
    kind: 'commit',
    hash: commit.hash,
    parents: commit.parents,
    commit
  }))

  for (const stash of stashes) {
    const baseIdx = items.findIndex((it) => it.hash === stash.baseHash)
    if (baseIdx === -1) continue
    let pos = items.findIndex((it) => itemDate(it) < stash.date)
    if (pos === -1 || pos > baseIdx) pos = baseIdx
    items.splice(pos, 0, { kind: 'stash', hash: stash.hash, parents: [stash.baseHash], stash })
  }

  if (showWip) items.unshift({ kind: 'wip', hash: WIP_HASH, parents: headHash ? [headHash] : [] })
  return items
}

function itemDate(item: GraphItem): number {
  if (item.kind === 'commit') return item.commit.commitDate
  if (item.kind === 'stash') return item.stash.date
  return Number.POSITIVE_INFINITY
}

export function layoutItems(items: GraphItem[]): GraphLayout {
  return computeGraph(items.map((it) => ({ hash: it.hash, parents: it.parents, dashed: it.kind !== 'commit' })))
}
