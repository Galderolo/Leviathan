import type { RepoOperation, RepoState } from '../../shared/types'

/**
 * The operation a failed command left part-way (a merge, rebase, cherry-pick
 * or revert that stopped, usually for conflicts) and how many files are in
 * conflict, or null when it started none: either nothing is under way, or the
 * operation was already there and git refused the command.
 */
export function stoppedOperation(
  before: RepoOperation,
  after: Pick<RepoState, 'operation' | 'status'> | null
): { operation: NonNullable<RepoOperation>; conflicts: number } | null {
  if (before || !after?.operation) return null
  return { operation: after.operation, conflicts: after.status.conflicted.length }
}
