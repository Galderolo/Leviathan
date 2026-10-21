import type { GitRef, Remote } from '../../shared/types'

/**
 * Remotes the user must pick from before pushing `branch`, or null when there
 * is nothing to ask: the branch already tracks a remote branch, or at most one
 * remote exists.
 */
export function remotesToChooseFrom(branch: string, refs: GitRef[], remotes: Remote[]): string[] | null {
  const local = refs.find((r) => r.type === 'head' && r.name === branch)
  if (local?.upstream || remotes.length < 2) return null
  return remotes.map((r) => r.name)
}
