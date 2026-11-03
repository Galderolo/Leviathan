import { describe, expect, it } from 'vitest'
import { conflictLayout } from '../src/renderer/src/conflictLayout'
import { parseConflicts } from '../src/shared/conflicts'

const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}\n`).join('')
const conflict = (ours: string, theirs: string) => `<<<<<<< HEAD\n${ours}=======\n${theirs}>>>>>>> feature/jump\n`

describe('conflictLayout', () => {
  it('makes one hunk: common lines as context, the current side removed, the incoming side added', () => {
    const { hunk } = conflictLayout(
      parseConflicts('using A;\r\n' + conflict('speed = 6.5f;\n', 'speed = 8f;\nextra;\n') + 'end\n')
    )
    expect(hunk.lines).toEqual([
      { type: 'ctx', oldNo: 1, newNo: 1, text: 'using A;' },
      { type: 'del', oldNo: 2, text: 'speed = 6.5f;' },
      { type: 'add', newNo: 2, text: 'speed = 8f;' },
      { type: 'add', newNo: 3, text: 'extra;' },
      // Numbered in each version: line 3 of the current one, line 4 of the incoming one.
      { type: 'ctx', oldNo: 3, newNo: 4, text: 'end' }
    ])
  })

  it('folds the common lines far from any conflict, keeping a few around each', () => {
    const text =
      lines('top', 10) + conflict('a\n', 'b\n') + lines('mid', 10) + conflict('c\n', 'd\n') + lines('bottom', 2)
    const { parts } = conflictLayout(parseConflicts(text), 3)
    expect(parts).toEqual([
      { kind: 'fold', id: 0, from: 0, to: 7 },
      { kind: 'lines', from: 7, to: 10 },
      { kind: 'conflict', index: 0, ours: [10, 11], theirs: [11, 12] },
      { kind: 'lines', from: 12, to: 15 },
      { kind: 'fold', id: 1, from: 15, to: 19 },
      { kind: 'lines', from: 19, to: 22 },
      { kind: 'conflict', index: 1, ours: [22, 23], theirs: [23, 24] },
      // Too few to fold.
      { kind: 'lines', from: 24, to: 26 }
    ])
  })

  it('does not fold a single line away', () => {
    const { parts } = conflictLayout(parseConflicts(lines('top', 4) + conflict('a\n', 'b\n')), 3)
    expect(parts[0]).toEqual({ kind: 'lines', from: 0, to: 4 })
  })

  it('shows every line of a file without conflicts', () => {
    expect(conflictLayout(parseConflicts(lines('x', 30))).parts).toEqual([{ kind: 'lines', from: 0, to: 30 }])
  })
})
