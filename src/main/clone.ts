import * as accounts from './accounts'
import * as repo from './git/repository'
import type { ProgressFn } from './git/repository'
import * as submodules from './git/submodules'

/**
 * Clones `url` into `dest`, with an account's credentials when given, and binds the new repository to it.
 * Once git has cloned, the repository is there whatever happens next: a binding or submodule failure comes
 * back with its path instead of failing the clone.
 */
export async function cloneWithAccount(
  url: string,
  dest: string,
  accountId: string | null | undefined,
  recurseSubmodules: boolean | undefined,
  onProgress: ProgressFn
): Promise<{ path: string; submoduleError: string | null; bindError: string | null }> {
  const args = accountId ? accounts.cloneArgsFor(accountId) : []
  const path = await repo.cloneRepo(url, dest, onProgress, args)
  // Bound first, so private submodules on the same host are fetched with that account too.
  const bindError = accountId
    ? await accounts.setRepoAccount(path, accountId).then(
        () => null,
        (err: unknown) => (err instanceof Error ? err.message : String(err))
      )
    : null
  const submoduleError = recurseSubmodules ? await submodules.initSubmodules(path, onProgress) : null
  return { path, submoduleError, bindError }
}
