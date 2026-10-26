import type { GitRef, HeadInfo, Remote, RepoState } from '../../shared/types'

/**
 * How many commits a push would send, as the graph marks them: those ahead of
 * the upstream, or, for a branch without one (never pushed, or its remote
 * branch deleted), those on no remote. git only counts "ahead" against an upstream.
 */
export function pushCount(state: Pick<RepoState, 'head' | 'unpushed'>): number {
  return state.head.ahead || state.unpushed.length
}

/** Commits to pull and to push on the checked-out branch, as the toolbar counts them; null when there are none. */
export function syncCounts(state: Pick<RepoState, 'head' | 'unpushed'> | null): { pull: number; push: number } | null {
  if (!state) return null
  const pull = state.head.behind
  const push = pushCount(state)
  return pull || push ? { pull, push } : null
}

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

/**
 * Whether git refused a push because the remote branch has commits that are not here yet ("fetch first",
 * "non-fast-forward"): pulling first fixes it. A force push with lease refused ("stale info") is not one of them.
 */
export function pushNeedsPull(message: string): boolean {
  return /\[rejected\][^\n]*\((fetch first|non-fast-forward)\)/.test(message)
}
