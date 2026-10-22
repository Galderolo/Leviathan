import { describe, expect, it } from 'vitest'
import { buildGraphItems, computeGraph, graphColumnWidth, WIP_HASH } from '../src/shared/graph'
import type { Commit, Stash } from '../src/shared/types'

const node = (hash: string, ...parents: string[]) => ({ hash, parents })

function commit(hash: string, parents: string[], date: number): Commit {
  return {
    hash,
    parents,
    authorName: 'A',
    authorEmail: 'a@x',
    authorDate: date,
    committerName: 'A',
    committerEmail: 'a@x',
    commitDate: date,
    subject: hash
  }
}

describe('computeGraph', () => {
  it('keeps a linear history in a single lane', () => {
    const { rows, maxWidth } = computeGraph([node('c', 'b'), node('b', 'a'), node('a')])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(maxWidth).toBe(1)
    expect(rows[0].lines).toEqual([{ from: 0, to: 0, kind: 'bottom', color: 0, dashed: false }])
    expect(rows[1].lines.map((l) => l.kind)).toEqual(['top', 'bottom'])
    expect(rows[2].lines.map((l) => l.kind)).toEqual(['top'])
  })

  it('opens a second lane for a merge parent and closes it at the fork point', () => {
    // m merges b2 into a2; both branch off a1.
    //   m
    //   |\
    //   a2 b2
    //   | /
    //   a1
    const { rows, maxWidth } = computeGraph([node('m', 'a2', 'b2'), node('a2', 'a1'), node('b2', 'a1'), node('a1')])
    expect(maxWidth).toBe(2)
    expect(rows.map((r) => r.column)).toEqual([0, 0, 1, 0])
    // merge edge goes from lane 0 to lane 1
    expect(rows[0].lines).toContainEqual(expect.objectContaining({ from: 0, to: 1, kind: 'bottom' }))
    // b2 continues in lane 1 down to a1, where it converges into lane 0
    expect(rows[3].lines).toContainEqual(expect.objectContaining({ from: 1, to: 0, kind: 'top' }))
    // lane 1 passes through the a2 row
    expect(rows[1].lines).toContainEqual(expect.objectContaining({ from: 1, to: 1, kind: 'full' }))
  })

  it('gives branch tips without visible children a new lane', () => {
    const { rows } = computeGraph([node('x', 'base'), node('y', 'base'), node('base')])
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0])
    expect(rows[0].color).not.toBe(rows[1].color)
  })

  it('reuses freed lanes', () => {
    const { rows, maxWidth } = computeGraph([
      node('m', 'a', 'b'),
      node('b', 'a'),
      node('a', 'r'),
      node('t', 'r'),
      node('r')
    ])
    expect(maxWidth).toBe(2)
    expect(rows[3].column).toBe(1)
  })

  it('propagates dashed edges from WIP nodes down their lane', () => {
    const { rows } = computeGraph([{ hash: 'wip', parents: ['h'], dashed: true }, node('other', 'h'), node('h')])
    expect(rows[0].lines[0].dashed).toBe(true)
    expect(rows[1].lines).toContainEqual(expect.objectContaining({ from: 0, kind: 'full', dashed: true }))
    expect(rows[2].lines).toContainEqual(expect.objectContaining({ from: 0, kind: 'top', dashed: true }))
  })
})

describe('buildGraphItems', () => {
  const commits = [commit('c3', ['c2'], 300), commit('c2', ['c1'], 200), commit('c1', [], 100)]

  it('prepends the WIP item pointing at HEAD', () => {
    const items = buildGraphItems(commits, [], 'c3', true)
    expect(items[0]).toEqual({ kind: 'wip', hash: WIP_HASH, parents: ['c3'] })
    expect(items).toHaveLength(4)
  })

  it('inserts stashes by date but never after their base commit', () => {
    const stash: Stash = { index: 0, ref: 'stash@{0}', hash: 's0', baseHash: 'c2', message: 'WIP', date: 250 }
    const items = buildGraphItems(commits, [stash], 'c3', false)
    expect(items.map((i) => i.hash)).toEqual(['c3', 's0', 'c2', 'c1'])

    const late: Stash = { ...stash, hash: 's1', baseHash: 'c1', date: 999 }
    const items2 = buildGraphItems(commits, [late], 'c3', false)
    expect(items2.map((i) => i.hash)).toEqual(['s1', 'c3', 'c2', 'c1'])

    const early: Stash = { ...stash, hash: 's2', baseHash: 'c2', date: 50 }
    const items3 = buildGraphItems(commits, [early], 'c3', false)
    expect(items3.map((i) => i.hash)).toEqual(['c3', 's2', 'c2', 'c1'])
  })

  it('skips stashes whose base is not loaded', () => {
    const stash: Stash = { index: 0, ref: 'stash@{0}', hash: 's', baseHash: 'zzz', message: '', date: 1 }
    expect(buildGraphItems(commits, [stash], 'c3', false)).toHaveLength(3)
  })
})

describe('graphColumnWidth', () => {
  it('is never narrower than about six lanes, and grows with more', () => {
    expect(graphColumnWidth(1)).toBe(graphColumnWidth(6))
    expect(graphColumnWidth(1)).toBeGreaterThanOrEqual(130)
    expect(graphColumnWidth(10)).toBeGreaterThan(graphColumnWidth(6))
    expect(graphColumnWidth(500)).toBe(graphColumnWidth(24))
  })
})
