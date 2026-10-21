import { describe, expect, it } from 'vitest'
import { diffSnapshots, invertChange, type Snapshot } from '../src/shared/undo'

const snap = (branch: string | null, hash: string, refs: Record<string, string>): Snapshot => ({
  head: { branch, hash },
  refs
})

describe('diffSnapshots', () => {
  it('lists moved, created and deleted refs', () => {
    const before = snap('main', 'a', { 'refs/heads/main': 'a', 'refs/heads/old': 'o', 'refs/tags/v1': 't' })
    const after = snap('main', 'b', { 'refs/heads/main': 'b', 'refs/heads/new': 'n', 'refs/tags/v1': 't' })
    expect(diffSnapshots(before, after, 'soft')).toEqual({
      refs: [
        { ref: 'refs/heads/main', from: 'a', to: 'b' },
        { ref: 'refs/heads/new', from: null, to: 'n' },
        { ref: 'refs/heads/old', from: 'o', to: null }
      ],
      head: { from: { branch: 'main', hash: 'a' }, to: { branch: 'main', hash: 'b' } },
      mode: 'soft'
    })
  })

  it('returns null when nothing changed', () => {
    const s = snap('main', 'a', { 'refs/heads/main': 'a' })
    expect(diffSnapshots(s, { ...s, refs: { ...s.refs } }, 'keep')).toBeNull()
  })

  it('records a checkout as a HEAD change only', () => {
    const refs = { 'refs/heads/main': 'a', 'refs/heads/dev': 'd' }
    expect(diffSnapshots(snap('main', 'a', refs), snap('dev', 'd', refs), 'keep')).toEqual({
      refs: [],
      head: { from: { branch: 'main', hash: 'a' }, to: { branch: 'dev', hash: 'd' } },
      mode: 'keep'
    })
  })
})

describe('invertChange', () => {
  it('swaps from and to for refs and HEAD, keeping the mode', () => {
    const change = diffSnapshots(
      snap('main', 'a', { 'refs/heads/main': 'a' }),
      snap('main', 'b', { 'refs/heads/main': 'b', 'refs/tags/x': 'x' }),
      'soft'
    )!
    expect(invertChange(change)).toEqual({
      refs: [
        { ref: 'refs/heads/main', from: 'b', to: 'a' },
        { ref: 'refs/tags/x', from: 'x', to: null }
      ],
      head: { from: { branch: 'main', hash: 'b' }, to: { branch: 'main', hash: 'a' } },
      mode: 'soft'
    })
  })
})
