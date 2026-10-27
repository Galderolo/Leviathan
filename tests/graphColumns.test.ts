import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLUMNS,
  clampGraphScroll,
  clampWidth,
  gridColumns,
  moveColumn,
  readColumnOrder,
  readGraphColumns,
  readHiddenColumns,
  writeColumnOrder,
  writeGraphColumns,
  writeHiddenColumns
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

describe('graph columns shown', () => {
  const widths = { refs: 200, graph: 120 }

  it('lays out every column, or leaves out the ones hidden', () => {
    expect(gridColumns(widths, [])).toBe('200px 120px minmax(140px, 1fr) minmax(90px, 150px) minmax(110px, 150px) 70px')
    expect(gridColumns(widths, ['author', 'sha'])).toBe('200px 120px minmax(140px, 1fr) minmax(110px, 150px)')
    expect(gridColumns(widths, ['author', 'date', 'sha'])).toBe('200px 120px minmax(140px, 1fr)')
  })

  it('remembers the columns hidden, and ignores what is not a column that can be', () => {
    const store = fakeStore()
    expect(readHiddenColumns(store)).toEqual([])
    writeHiddenColumns(['sha', 'author'], store)
    expect(readHiddenColumns(store)).toEqual(['author', 'sha'])
    store.setItem('leviathan.graphHiddenColumns', '["date","message","graph",3]')
    expect(readHiddenColumns(store)).toEqual(['date'])
    store.setItem('leviathan.graphHiddenColumns', 'nope')
    expect(readHiddenColumns(store)).toEqual([])
  })
})

describe('graph column order', () => {
  const widths = { refs: 200, graph: 120 }

  it('lays the columns out in the order they were dragged to', () => {
    expect(gridColumns(widths, [], ['sha', 'author', 'date'])).toBe(
      '200px 120px minmax(140px, 1fr) 70px minmax(90px, 150px) minmax(110px, 150px)'
    )
    expect(gridColumns(widths, ['author'], ['sha', 'author', 'date'])).toBe(
      '200px 120px minmax(140px, 1fr) 70px minmax(110px, 150px)'
    )
  })

  it('remembers the order, and starts from the usual one on anything else', () => {
    const store = fakeStore()
    expect(readColumnOrder(store)).toEqual(['author', 'date', 'sha'])
    writeColumnOrder(['sha', 'author', 'date'], store)
    expect(readColumnOrder(store)).toEqual(['sha', 'author', 'date'])
    for (const bad of ['["sha","author"]', '["sha","sha","date"]', '["sha","message","date"]', 'nope']) {
      store.setItem('leviathan.graphColumnOrder', bad)
      expect(readColumnOrder(store)).toEqual(['author', 'date', 'sha'])
    }
  })

  it('moves a column among the ones shown, leaving a hidden one where it was', () => {
    const order = ['author', 'date', 'sha'] as const
    // Into gap 0 of the shown columns: first.
    expect(moveColumn([...order], [], 'sha', 0)).toEqual(['sha', 'author', 'date'])
    expect(moveColumn([...order], [], 'author', 3)).toEqual(['date', 'sha', 'author'])
    // Dropped either side of itself: nothing moves.
    expect(moveColumn([...order], [], 'date', 1)).toEqual(['author', 'date', 'sha'])
    expect(moveColumn([...order], [], 'date', 2)).toEqual(['author', 'date', 'sha'])
    // Date hidden: author and SHA swap, date keeps its place in the middle.
    expect(moveColumn([...order], ['date'], 'sha', 0)).toEqual(['sha', 'date', 'author'])
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
