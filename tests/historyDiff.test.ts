import { describe, expect, it } from 'vitest'
import { historyDiffSource } from '../src/renderer/src/historyDiff'
import type { Commit, FileCommit } from '../src/shared/types'

const commit = { hash: 'h2', parents: ['h1'] } as Commit
const entry = (e: Partial<FileCommit>): FileCommit => ({ commit, path: 'b.txt', status: 'M', ...e })

describe('historyDiffSource', () => {
  it('compares a renamed file with its old name', () => {
    expect(historyDiffSource(entry({ status: 'R', oldPath: 'a.txt' }))).toEqual({
      kind: 'commit',
      hash: 'h2',
      parent: 'h1',
      path: 'b.txt',
      oldPath: 'a.txt'
    })
  })

  it('shows a copy as a new file (the original still exists)', () => {
    expect(historyDiffSource(entry({ status: 'C', oldPath: 'a.txt' }))).toEqual({
      kind: 'commit',
      hash: 'h2',
      parent: 'h1',
      path: 'b.txt'
    })
  })

  it('uses no parent for the first commit', () => {
    expect(historyDiffSource(entry({ commit: { hash: 'h0', parents: [] } as unknown as Commit })).parent).toBeNull()
  })
})
