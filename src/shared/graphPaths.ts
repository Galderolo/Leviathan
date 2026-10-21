import type { GraphLine } from './graph'

/** Pixel layout of one graph row. */
export interface GraphGeometry {
  rowHeight: number
  laneWidth: number
  /** x of lane 0. */
  padding: number
  /** Corner radius of the elbows where a lane turns into or out of a node. */
  radius: number
}

export function laneX(col: number, g: GraphGeometry): number {
  return g.padding + col * g.laneWidth
}

/**
 * SVG path for one segment of a row. Lanes run vertically; joining or leaving
 * a node is drawn as a vertical, a rounded elbow and a horizontal line.
 */
export function linePath(line: GraphLine, g: GraphGeometry): string {
  const h = g.rowHeight
  const mid = h / 2
  const x1 = laneX(line.from, g)
  const x2 = laneX(line.to, g)
  if (line.kind === 'full') return `M ${x1} 0 V ${h}`
  if (x1 === x2) return line.kind === 'top' ? `M ${x1} 0 V ${mid}` : `M ${x1} ${mid} V ${h}`

  const dir = Math.sign(x2 - x1)
  const r = Math.min(g.radius, Math.abs(x2 - x1), mid)
  if (line.kind === 'top') {
    // Down the source lane, turn towards the node, run into it.
    return `M ${x1} 0 V ${mid - r} Q ${x1} ${mid} ${x1 + dir * r} ${mid} H ${x2}`
  }
  // Out of the node towards the target lane, turn down, run to the bottom edge.
  return `M ${x1} ${mid} H ${x2 - dir * r} Q ${x2} ${mid} ${x2} ${mid + r} V ${h}`
}
