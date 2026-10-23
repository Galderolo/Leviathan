import type { Account, MergeMethod, Provider, Remote } from './types'

export const PROVIDERS: Provider[] = ['github', 'gitlab', 'bitbucket', 'gitea', 'other']

export const DEFAULT_HOSTS: Record<Provider, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
  gitea: '',
  other: ''
}

/** REST API root for a provider, or null when the provider has no API support. */
export function apiBase(provider: Provider, host: string): string | null {
  switch (provider) {
    case 'github':
      return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`
    case 'gitlab':
      return `https://${host}/api/v4`
    case 'bitbucket':
      // Bitbucket Cloud only: Bitbucket Data Center has another API (add it as "other").
      return host === 'bitbucket.org' ? 'https://api.bitbucket.org/2.0' : null
    case 'gitea':
      return `https://${host}/api/v1`
    default:
      return null
  }
}

/** Commit email that hides the real address (each provider's no-reply format). */
export function noreplyEmail(provider: Provider, host: string, id: number, username: string): string {
  switch (provider) {
    case 'github':
      return `${id}+${username}@users.noreply.${host}`
    case 'gitlab':
      return `${id}-${username}@users.noreply.${host}`
    default:
      return `${username}@noreply.${host}`
  }
}

/** Page where the user creates a personal access token, with the needed scopes preselected. */
export function tokenPageUrl(provider: Provider, host: string): string | null {
  switch (provider) {
    case 'github':
      return `https://${host}/settings/tokens/new?scopes=repo,workflow,read:user&description=Leviathan`
    case 'gitlab':
      return `https://${host}/-/user_settings/personal_access_tokens?name=Leviathan&scopes=api,read_user,write_repository`
    case 'bitbucket':
      // Atlassian API tokens: "Create API token with scopes", app Bitbucket (the scopes cannot be preselected).
      return 'https://id.atlassian.com/manage-profile/security/api-tokens'
    case 'gitea':
      return `https://${host}/user/settings/applications`
    default:
      return null
  }
}

/**
 * git `-c` arguments for a repository bound to an account: for the account's
 * host only, drop other credential helpers (so no other stored account is used)
 * and pin the username, which makes git ask askpass only for the password (the
 * account's token). Remotes and submodules on other hosts keep their helpers.
 */
export function credentialArgs(account: Pick<Account, 'host' | 'username'>): string[] {
  const scope = `credential.https://${account.host}`
  return ['-c', `${scope}.helper=`, '-c', `${scope}.username=${account.username}`]
}

/** Repository bindings without the ones that point at `accountId`. */
export function withoutAccount(map: Record<string, string>, accountId: string): Record<string, string> {
  return Object.fromEntries(Object.entries(map).filter(([, id]) => id !== accountId))
}

/** Whether any remote (HTTPS `https://host/...` or SSH `git@host:...`) points at `host`. */
export function hasRemoteOnHost(remotes: Remote[], host: string): boolean {
  const h = host.toLowerCase()
  const hostOf = (url: string) => {
    const m = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url) ?? /^[^@/]+@([^:/]+):/.exec(url)
    return m ? m[1].toLowerCase() : null
  }
  return remotes.some((r) => hostOf(r.fetchUrl) === h || hostOf(r.pushUrl) === h)
}

/** Leviathan's OAuth App on GitHub, to sign in from the browser (device flow). Public by design. */
export const GITHUB_CLIENT_ID = 'Ov23liIeu6UqggJLSdlI'
/** The same permissions a token made from the token page gets (`workflow`: pushes that change CI files). */
export const GITHUB_SCOPES = 'repo workflow read:user'

/** Leviathan's application on gitlab.com (sign-in from the browser, with PKCE). Public by design. */
export const GITLAB_CLIENT_ID = 'f6655291e303deffbfa9d7aa9dc8c88a0264f8b4354c33942da97316804c8e6e'
/** The browser comes back to http://127.0.0.1:<port>/callback, the address registered with the application. */
export const GITLAB_REDIRECT_PORT = 47231

/** The ways a provider can merge a pull request (GitLab rebases in a separate step, not when merging). */
export function mergeMethods(provider: Provider): MergeMethod[] {
  return provider === 'gitlab' ? ['merge', 'squash'] : ['merge', 'squash', 'rebase']
}
