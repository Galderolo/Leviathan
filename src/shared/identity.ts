import type { Account } from './types'

/** A commit author: `user.name` and `user.email` ('' when not set). */
export interface Identity {
  name: string
  email: string
}

/** Where the identity of a repository's next commit comes from. */
export type IdentitySource = 'account' | 'repo' | 'global' | 'none'

export interface CommitIdentity extends Identity {
  source: IdentitySource
  /** The account it is the identity of (`source` 'account'). */
  accountId: string | null
}

const RECENT_IDENTITIES = 5

/**
 * Who the next commit will be by: `local` is what the repository sets itself, `effective` what git uses (local,
 * global, system). A repository bound to an account has that account's identity until it is given another.
 */
export function commitIdentity(local: Identity, effective: Identity, bound: Account | null): CommitIdentity {
  if (bound && local.name === bound.name && local.email === bound.email) {
    return { ...local, source: 'account', accountId: bound.id }
  }
  const source = local.name || local.email ? 'repo' : effective.name || effective.email ? 'global' : 'none'
  return { name: effective.name, email: effective.email, source, accountId: null }
}

/** `recent` with `identity` first, once (emails compared ignoring case), at most five. */
export function rememberIdentity(recent: Identity[], identity: Identity): Identity[] {
  const same = (a: Identity) => a.name === identity.name && a.email.toLowerCase() === identity.email.toLowerCase()
  return [identity, ...recent.filter((r) => !same(r))].slice(0, RECENT_IDENTITIES)
}
