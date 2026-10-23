import type { DiffSource, FileChange, FileCommit } from '../../shared/types'

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

/** The files of a commit inside `folder`, including those moved into it or out of it. */
export function filesInFolder(files: FileChange[], folder: string): FileChange[] {
  const prefix = `${folder.replace(/\/+$/, '')}/`
  return files.filter((f) => f.path.startsWith(prefix) || !!f.origPath?.startsWith(prefix))
}

/** The folders above a path, outermost first, as a header shows them: `a/b/c.txt` → `a/`, `b/`. */
export function folderSteps(path: string): { label: string; folder: string }[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((part, i) => ({ label: `${part}/`, folder: parts.slice(0, i + 1).join('/') }))
}
