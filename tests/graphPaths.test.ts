import { describe, expect, it } from 'vitest'
import type { GraphLine } from '../src/shared/graph'
import { laneX, linePath, type GraphGeometry } from '../src/shared/graphPaths'

const g: GraphGeometry = { rowHeight: 30, laneWidth: 20, padding: 10, radius: 6 }
const line = (from: number, to: number, kind: GraphLine['kind']): GraphLine => ({
  from,
  to,
  kind,
  color: 0,
  dashed: false
})

describe('graph paths', () => {
  it('places lanes at padding + column * laneWidth', () => {
    expect(laneX(0, g)).toBe(10)
    expect(laneX(3, g)).toBe(70)
  })

  it('draws pass-through lanes as full-height verticals', () => {
    expect(linePath(line(1, 1, 'full'), g)).toBe('M 30 0 V 30')
  })

  it('draws straight halves when the lane does not change', () => {
    expect(linePath(line(0, 0, 'top'), g)).toBe('M 10 0 V 15')
    expect(linePath(line(0, 0, 'bottom'), g)).toBe('M 10 15 V 30')
  })

  it('joins a lane into a node with a vertical, a rounded elbow and a horizontal', () => {
    expect(linePath(line(2, 0, 'top'), g)).toBe('M 50 0 V 9 Q 50 15 44 15 H 10')
  })

  it('leaves a node horizontally and turns down into the parent lane', () => {
    expect(linePath(line(0, 1, 'bottom'), g)).toBe('M 10 15 H 24 Q 30 15 30 21 V 30')
    expect(linePath(line(2, 0, 'bottom'), g)).toBe('M 50 15 H 16 Q 10 15 10 21 V 30')
  })

  it('never uses a corner radius larger than the space available', () => {
    expect(linePath(line(1, 0, 'top'), { ...g, radius: 30 })).toBe('M 30 0 V 0 Q 30 15 15 15 H 10')
  })
})
