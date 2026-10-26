import { describe, expect, it } from 'vitest'
import { moveTab } from '../src/renderer/src/tabOrder'

const tabs = ['a', 'b', 'c'].map((id) => ({ id }))
const ids = (list: { id: string }[]) => list.map((tab) => tab.id)

describe('moveTab', () => {
  it('moves a tab into the gap it is dropped on', () => {
    expect(ids(moveTab(tabs, 'a', 3))).toEqual(['b', 'c', 'a'])
    expect(ids(moveTab(tabs, 'c', 0))).toEqual(['c', 'a', 'b'])
    expect(ids(moveTab(tabs, 'a', 2))).toEqual(['b', 'a', 'c'])
    expect(ids(moveTab(tabs, 'c', 1))).toEqual(['a', 'c', 'b'])
  })

  it('leaves the order alone when the tab is dropped next to itself', () => {
    expect(moveTab(tabs, 'b', 1)).toBe(tabs)
    expect(moveTab(tabs, 'b', 2)).toBe(tabs)
  })

  it('ignores a tab that is not in the list', () => {
    expect(moveTab(tabs, 'x', 0)).toBe(tabs)
  })
})
