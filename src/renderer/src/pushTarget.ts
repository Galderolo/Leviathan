import type { GitRef, HeadInfo, Remote } from '../../shared/types'

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

/** Where a push right after committing goes (`origin/develop`), or null when there is no branch or no remote. */
export function pushAfterCommitTarget(head: HeadInfo, remotes: Remote[]): string | null {
  if (!head.branch) return null
  if (head.upstream) return head.upstream
  const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0]
  return remote ? `${remote.name}/${head.branch}` : null
}

/** An amend that replaced a commit the remote already has: pushing it would need a force push. */
export function amendsPushedCommit(amend: boolean, before: { head: HeadInfo; unpushed: string[] }): boolean {
  return amend && !!before.head.hash && !before.unpushed.includes(before.head.hash)
}
