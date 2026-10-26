import type { Account, GitRef, Remote } from './types'

/**
 * The host and project path a remote URL points at (`github.com` + `owner/repo`),
 * for HTTPS, `ssh://` and SCP-style (`git@host:owner/repo.git`) URLs. The port is
 * kept for HTTPS, where the API lives on the same port, and dropped for SSH.
 */
export function parseRemoteUrl(url: string): { host: string; path: string } | null {
  const trimmed = url.trim()
  let host: string
  let path: string
  const web = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.*)$/i.exec(trimmed)
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.*)$/i.exec(trimmed)
  // SCP form: no scheme, host of 2+ characters (so `C:/repo` is a Windows path), path not absolute.
  const scp = /^(?:[^@/\s]+@)?([^:/\s]{2,}):(?!\/)(.+)$/.exec(trimmed)
  if (web) [, host, path] = web
  else if (ssh) [, host, path] = ssh
  else if (scp && !/^[a-z][a-z+.-]*:\/\//i.test(trimmed)) [, host, path] = scp
  else return null
  path = path
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+/, '')
  if (!path.includes('/')) return null
  return { host: host.toLowerCase(), path }
}

function originFirst(remotes: Remote[]): Remote[] {
  return [...remotes.filter((r) => r.name === 'origin'), ...remotes.filter((r) => r.name !== 'origin')]
}

/**
 * The account whose identity a repository's commits take by default: on the first remote (origin first) with
 * accounts on its host, the one that owns the project (its user is the first part of the path), or else the first
 * that `canPush` to it. Null when none does.
 */
export async function defaultIdentityAccount(
  remotes: Remote[],
  accounts: Account[],
  canPush: (account: Account, path: string) => Promise<boolean>
): Promise<Account | null> {
  for (const remote of originFirst(remotes)) {
    const project = parseRemoteUrl(remote.fetchUrl)
    if (!project) continue
    const onHost = accounts.filter((a) => a.provider !== 'other' && a.host.toLowerCase() === project.host)
    const owner = project.path.split('/')[0].toLowerCase()
    const owning = onHost.find((a) => a.username.toLowerCase() === owner)
    if (owning) return owning
    for (const account of onHost) if (await canPush(account, project.path)) return account
  }
  return null
}

/**
 * The hosted project to use for pull requests: the first remote (origin first)
 * on a host with an account that has API support, with the account the
 * repository is bound to when it is on that host.
 */
export function pickProject(
  remotes: Remote[],
  accounts: Account[],
  boundId: string | null
): { remote: string; account: Account; path: string } | null {
  for (const remote of originFirst(remotes)) {
    const project = parseRemoteUrl(remote.fetchUrl)
    if (!project) continue
    const onHost = accounts.filter((a) => a.provider !== 'other' && a.host.toLowerCase() === project.host)
    const account = onHost.find((a) => a.id === boundId) ?? onHost[0]
    if (account) return { remote: remote.name, account, path: project.path }
  }
  return null
}

/**
 * Whether a branch has to be pushed before a pull request can be opened from it:
 * the pull request takes the branch of the same name on `remote`, so that one
 * must exist and hold all of the local commits.
 */
export function needsPushForPullRequest(
  ref: Pick<GitRef, 'name' | 'upstream' | 'ahead' | 'upstreamGone'>,
  remote: string
): boolean {
  return ref.upstream !== `${remote}/${ref.name}` || !!ref.upstreamGone || !!ref.ahead
}
