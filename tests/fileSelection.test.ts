import { describe, expect, it } from 'vitest'
import {
  clickSelection,
  emptySelection,
  focusSelection,
  pruneSelection,
  splitRatio,
  toggleAll,
  type FileSelection
} from '../src/renderer/src/fileSelection'

const order = ['a', 'b', 'c', 'd', 'e']
const sel = (paths: string[], anchor: string | null = null): FileSelection => ({ paths: new Set(paths), anchor })
const plain = { shift: false, toggle: false }
const ctrl = { shift: false, toggle: true }
const shift = { shift: true, toggle: false }
const both = { shift: true, toggle: true }
const paths = (s: FileSelection) => [...s.paths].sort()

describe('clickSelection', () => {
  it('a plain click selects only that file', () => {
    const next = clickSelection(sel(['a', 'c'], 'a'), order, 'd', plain)
    expect(paths(next)).toEqual(['d'])
    expect(next.anchor).toBe('d')
  })

  it('Ctrl adds or removes one file', () => {
    const added = clickSelection(sel(['a'], 'a'), order, 'c', ctrl)
    expect(paths(added)).toEqual(['a', 'c'])
    expect(added.anchor).toBe('c')
    expect(paths(clickSelection(added, order, 'a', ctrl))).toEqual(['c'])
  })

  it('Shift selects the range from the last click, in either direction', () => {
    expect(paths(clickSelection(sel(['b'], 'b'), order, 'd', shift))).toEqual(['b', 'c', 'd'])
    expect(paths(clickSelection(sel(['d'], 'd'), order, 'a', shift))).toEqual(['a', 'b', 'c', 'd'])
    // The anchor stays, so the range can be changed with another Shift click.
    const first = clickSelection(sel(['b'], 'b'), order, 'e', shift)
    expect(paths(clickSelection(first, order, 'c', shift))).toEqual(['b', 'c'])
  })

  it('Ctrl+Shift adds the range to what was selected', () => {
    expect(paths(clickSelection(sel(['a', 'd'], 'd'), order, 'e', both))).toEqual(['a', 'd', 'e'])
  })

  it('Shift without a previous click selects from the top', () => {
    expect(paths(clickSelection(emptySelection(), order, 'c', shift))).toEqual(['a', 'b', 'c'])
  })
})

describe('focusSelection', () => {
  it('a click that only opens a file keeps the checked files and starts Shift ranges there', () => {
    const focused = focusSelection(sel(['a', 'e'], 'a'), 'c')
    expect(paths(focused)).toEqual(['a', 'e'])
    expect(paths(clickSelection(focused, order, 'd', shift))).toEqual(['c', 'd'])
  })
})

describe('toggleAll', () => {
  it('selects everything, or nothing when everything already is', () => {
    expect(paths(toggleAll(sel(['a']), order))).toEqual(order)
    expect(paths(toggleAll(sel(order), order))).toEqual([])
  })
})

describe('pruneSelection', () => {
  it('forgets files that left the list, and the anchor if it did', () => {
    const next = pruneSelection(sel(['a', 'x'], 'x'), order)
    expect(paths(next)).toEqual(['a'])
    expect(next.anchor).toBeNull()
  })

  it('returns the same selection when nothing changed', () => {
    const same = sel(['a', 'b'], 'a')
    expect(pruneSelection(same, order)).toBe(same)
  })
})

describe('splitRatio', () => {
  it('keeps both lists usable', () => {
    expect(splitRatio(0.5)).toBe(0.5)
    expect(splitRatio(0.01)).toBe(0.15)
    expect(splitRatio(0.99)).toBe(0.85)
    expect(splitRatio(Number.NaN)).toBe(0.5)
  })
})
