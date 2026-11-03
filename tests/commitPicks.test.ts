import { describe, expect, it } from 'vitest'
import { pickCommits, oldestFirst } from '../src/renderer/src/commitPicks'

// The graph's order: newest first.
const order = ['e', 'd', 'c', 'b', 'a']

describe('pickCommits', () => {
  it('adds a commit with Ctrl, the one selected before too, and takes it out again', () => {
    expect(pickCommits([], 'd', 'b', 'toggle', order)).toEqual(['d', 'b'])
    expect(pickCommits(['d', 'b'], 'b', 'c', 'toggle', order)).toEqual(['d', 'b', 'c'])
    expect(pickCommits(['d', 'b', 'c'], 'c', 'b', 'toggle', order)).toEqual(['d', 'c'])
  })

  it('picks every commit between the selected one and the clicked one with Shift', () => {
    expect(pickCommits([], 'd', 'a', 'range', order)).toEqual(['d', 'c', 'b', 'a'])
    expect(pickCommits(['e'], 'b', 'd', 'range', order)).toEqual(['d', 'c', 'b'])
  })

  it('starts from the clicked commit alone without one selected before', () => {
    expect(pickCommits([], null, 'c', 'toggle', order)).toEqual(['c'])
    expect(pickCommits([], null, 'c', 'range', order)).toEqual(['c'])
  })
})

describe('oldestFirst', () => {
  it('puts the picked commits in the order they were made', () => {
    expect(oldestFirst(['b', 'e', 'c'], order)).toEqual(['b', 'c', 'e'])
  })
})
