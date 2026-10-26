import type { DiffSource, FileChange, WorkingStatus } from '../../shared/types'

/**
 * Where an open working-tree diff should go after a refresh: the same source
 * while its file is still in that list, the other list when the file moved
 * there whole (staged or unstaged), or null when it has no changes left. A
 * conflict stays in the conflict editor only while the file is in conflict.
 */
export function followDiff(source: DiffSource, status: WorkingStatus): DiffSource | null {
  if (source.kind === 'commit') return source
  const unstaged = status.unstaged.find((f) => f.path === source.path)
  const staged = status.staged.find((f) => f.path === source.path)
  const conflicted = status.conflicted.some((f) => f.path === source.path)
  if (source.kind === 'unstaged' && source.conflicted) {
    if (conflicted) return source
    if (unstaged) return unstagedSource(source.path, unstaged)
    return staged ? { kind: 'staged', path: source.path } : null
  }
  if (source.kind === 'unstaged' ? unstaged || conflicted : staged) return source
  if (source.kind === 'unstaged' && staged) return { kind: 'staged', path: source.path }
  if (source.kind === 'staged' && unstaged) return unstagedSource(source.path, unstaged)
  return null
}

function unstagedSource(path: string, file: FileChange): DiffSource {
  return file.status === '?' ? { kind: 'unstaged', path, untracked: true } : { kind: 'unstaged', path }
}
