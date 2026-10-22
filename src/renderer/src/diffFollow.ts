import type { DiffSource, WorkingStatus } from '../../shared/types'

/**
 * Where an open working-tree diff should go after a refresh: the same source
 * while its file is still in that list, the other list when the file moved
 * there whole (staged or unstaged), or null when it has no changes left.
 */
export function followDiff(source: DiffSource, status: WorkingStatus): DiffSource | null {
  if (source.kind === 'commit') return source
  if (source.kind === 'unstaged' && source.conflicted) return source
  const unstaged = status.unstaged.find((f) => f.path === source.path)
  const staged = status.staged.find((f) => f.path === source.path)
  const conflicted = status.conflicted.some((f) => f.path === source.path)
  if (source.kind === 'unstaged' ? unstaged || conflicted : staged) return source
  if (source.kind === 'unstaged' && staged) return { kind: 'staged', path: source.path }
  if (source.kind === 'staged' && unstaged) {
    return unstaged.status === '?'
      ? { kind: 'unstaged', path: source.path, untracked: true }
      : { kind: 'unstaged', path: source.path }
  }
  return null
}
