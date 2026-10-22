import type { RepoState } from '../../shared/types'

/**
 * What to show once a checkout succeeded: the uncommitted changes when there
 * are any (they came along to the new branch), otherwise the commit HEAD now
 * points to. Null when there is nothing to show (no state, or no commits yet).
 */
export function viewAfterCheckout(
  state: Pick<RepoState, 'head' | 'status'> | null
): { kind: 'wip' } | { kind: 'commit'; hash: string } | null {
  if (!state) return null
  const { staged, unstaged, conflicted } = state.status
  if (staged.length + unstaged.length + conflicted.length > 0) return { kind: 'wip' }
  return state.head.hash ? { kind: 'commit', hash: state.head.hash } : null
}
