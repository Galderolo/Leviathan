import { describe, expect, it } from 'vitest'
import { filesInFolder, folderSteps, historyDiffSource } from '../src/renderer/src/historyDiff'
import type { Commit, FileChange, FileCommit } from '../src/shared/types'

describe('folder history', () => {
  it('keeps the files of a commit inside the folder, those moved in or out of it too', () => {
    const files: FileChange[] = [
      { path: 'Assets/UI/Menu.cs', status: 'M' },
      { path: 'AssetsOld/x.cs', status: 'A' },
      { path: 'Assets/Hud.cs', status: 'R', origPath: 'Old/Hud.cs' },
      { path: 'Archive/Boss.cs', status: 'R', origPath: 'Assets/Boss.cs' },
      { path: 'README.md', status: 'M' }
    ]
    expect(filesInFolder(files, 'Assets').map((f) => f.path)).toEqual([
      'Assets/UI/Menu.cs',
      'Assets/Hud.cs',
      'Archive/Boss.cs'
    ])
    expect(filesInFolder(files, 'Assets/UI/').map((f) => f.path)).toEqual(['Assets/UI/Menu.cs'])
  })

  it('names the folders above a path, outermost first, for the header to go up to', () => {
    expect(folderSteps('Assets/UI/Menu.cs')).toEqual([
      { label: 'Assets/', folder: 'Assets' },
      { label: 'UI/', folder: 'Assets/UI' }
    ])
    expect(folderSteps('Assets/UI')).toEqual([{ label: 'Assets/', folder: 'Assets' }])
    expect(folderSteps('README.md')).toEqual([])
  })
})

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
