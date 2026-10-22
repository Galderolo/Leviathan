import type { DiffSource, FileCommit } from '../../shared/types'

type CommitDiffSource = Extract<DiffSource, { kind: 'commit' }>

/**
 * The diff to show for a file in one commit of its history. Only a rename
 * compares with the old name: after a copy the original still exists, and
 * asking for both paths would mix two files into one diff.
 */
export function historyDiffSource(entry: FileCommit): CommitDiffSource {
  const source: CommitDiffSource = {
    kind: 'commit',
    hash: entry.commit.hash,
    parent: entry.commit.parents[0] ?? null,
    path: entry.path
  }
  return entry.status === 'R' && entry.oldPath ? { ...source, oldPath: entry.oldPath } : source
}
