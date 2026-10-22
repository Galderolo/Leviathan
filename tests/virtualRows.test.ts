import { describe, expect, it } from 'vitest'
import { visibleRange } from '../src/renderer/src/virtualRows'

const base = { rowHeight: 25, overscan: 5, offset: 0 }

describe('visibleRange', () => {
  it('renders the rows on screen plus a few around them', () => {
    expect(visibleRange({ ...base, scrollTop: 0, viewport: 250, count: 1000 })).toEqual({ start: 0, end: 15 })
    expect(visibleRange({ ...base, scrollTop: 2500, viewport: 250, count: 1000 })).toEqual({ start: 95, end: 115 })
  })

  it('accounts for content above the list in the same scroller', () => {
    // The list starts 400 px down: nothing of it is on screen yet but the first rows.
    expect(visibleRange({ ...base, offset: 400, scrollTop: 0, viewport: 300, count: 1000 })).toEqual({
      start: 0,
      end: 1
    })
    expect(visibleRange({ ...base, offset: 400, scrollTop: 900, viewport: 300, count: 1000 })).toEqual({
      start: 15,
      end: 37
    })
  })

  it('never goes past the ends of the list', () => {
    expect(visibleRange({ ...base, scrollTop: 0, viewport: 1000, count: 10 })).toEqual({ start: 0, end: 10 })
    expect(visibleRange({ ...base, scrollTop: 99999, viewport: 250, count: 10 })).toEqual({ start: 10, end: 10 })
    expect(visibleRange({ ...base, scrollTop: 0, viewport: 250, count: 0 })).toEqual({ start: 0, end: 0 })
  })
})
