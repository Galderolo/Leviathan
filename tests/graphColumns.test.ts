import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLUMNS,
  clampGraphScroll,
  clampWidth,
  readGraphColumns,
  writeGraphColumns
} from '../src/renderer/src/graphColumns'
import { graphContentWidth } from '../src/shared/graph'

function fakeStore() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k)
  }
}

describe('graph column widths', () => {
  it('starts with room for a branch name and about eight lanes', () => {
    expect(readGraphColumns(fakeStore())).toEqual(DEFAULT_COLUMNS)
    expect(DEFAULT_COLUMNS.graph).toBe(graphContentWidth(8))
  })

  it('remembers the widths the user dragged to, within limits', () => {
    const store = fakeStore()
    writeGraphColumns({ refs: 260, graph: 300 }, store)
    expect(readGraphColumns(store)).toEqual({ refs: 260, graph: 300 })
    writeGraphColumns({ refs: 5, graph: 99999 }, store)
    expect(readGraphColumns(store)).toEqual({ refs: clampWidth('refs', 5), graph: clampWidth('graph', 99999) })
    expect(clampWidth('refs', 5)).toBeGreaterThan(5)
    expect(clampWidth('graph', 99999)).toBeLessThan(99999)
  })

  it('falls back to the defaults on bad data', () => {
    const store = fakeStore()
    store.setItem('leviathan.graphColumns', '{"refs":"wide"}')
    expect(readGraphColumns(store)).toEqual(DEFAULT_COLUMNS)
    store.setItem('leviathan.graphColumns', 'nope')
    expect(readGraphColumns(store)).toEqual(DEFAULT_COLUMNS)
  })
})

describe('graph scrolling', () => {
  it('needs the width of every lane, and scrolls only as far as the last one', () => {
    expect(graphContentWidth(1)).toBeLessThan(graphContentWidth(2))
    expect(clampGraphScroll(50, 400, 200)).toBe(50)
    expect(clampGraphScroll(500, 400, 200)).toBe(200)
    expect(clampGraphScroll(-10, 400, 200)).toBe(0)
    // Everything fits: nothing to scroll.
    expect(clampGraphScroll(80, 150, 200)).toBe(0)
  })
})
