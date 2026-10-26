import type { RepoOperation, RepoState } from '../../shared/types'

/**
 * The operation a failed command left part-way (a merge, rebase, cherry-pick
 * or revert that stopped, usually for conflicts) and how many files are in
 * conflict, or null when it started none: either nothing is under way, or the
 * operation was already there and git refused the command.
 */
/**
 * Why git stopped, from its message: its errors, without the progress, the hints and the lines that name commands
 * the app does not offer (`git rebase --continue`...).
 */
export function stopReason(message: string): string {
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(hint:|Rebasing \(|Could not apply |Aborting$)/.test(line))
    .map((line) => line.replace(/^(error|fatal): /, ''))
    .join('\n')
}

export function stoppedOperation(
  before: RepoOperation,
  after: Pick<RepoState, 'operation' | 'status'> | null
): { operation: NonNullable<RepoOperation>; conflicts: number } | null {
  if (before || !after?.operation) return null
  return { operation: after.operation, conflicts: after.status.conflicted.length }
}
