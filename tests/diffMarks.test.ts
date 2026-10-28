import { describe, expect, it } from 'vitest'
import { changeMarks } from '../src/renderer/src/diffMarks'

const line = (kind: 'add' | 'del', top: number, height = 20) => ({ kind, top, height })

describe('changeMarks', () => {
  it('places each change where it is in the whole diff, as a share of its height', () => {
    expect(changeMarks([line('del', 100), line('add', 500)], 1000)).toEqual([
      { kind: 'del', top: 0.1, height: 0.02 },
      { kind: 'add', top: 0.5, height: 0.02 }
    ])
  })

  it('joins the lines of a change that follow one another into one mark', () => {
    expect(changeMarks([line('add', 100), line('add', 120), line('add', 140), line('add', 400)], 1000)).toEqual([
      { kind: 'add', top: 0.1, height: 0.06 },
      { kind: 'add', top: 0.4, height: 0.02 }
    ])
  })

  it('keeps deletions and additions apart, even side by side', () => {
    expect(changeMarks([line('del', 100), line('add', 100), line('del', 120), line('add', 120)], 1000)).toEqual([
      { kind: 'del', top: 0.1, height: 0.04 },
      { kind: 'add', top: 0.1, height: 0.04 }
    ])
  })

  it('has nothing to show without changes or height', () => {
    expect(changeMarks([], 1000)).toEqual([])
    expect(changeMarks([line('add', 0)], 0)).toEqual([])
  })
})
