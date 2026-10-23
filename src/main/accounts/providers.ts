import { apiBase, noreplyEmail } from '../../shared/providers'
import type { NewPullRequest, Provider, PullRequest, RemoteRepo } from '../../shared/types'

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const LABELS: Record<Provider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  gitea: 'Gitea',
  other: 'The server'
}

function authHeaders(provider: Provider, token: string): Record<string, string> {
  switch (provider) {
    case 'github':
      return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    case 'gitlab':
    case 'bitbucket':
      // GitLab: personal access tokens and the tokens of a GitLab sign-in alike. Bitbucket: API tokens.
      return { Authorization: `Bearer ${token}` }
    default:
      return { Authorization: `token ${token}` }
  }
}

type Json = Record<string, unknown>

/** The provider's own explanation in an error body (GitHub, GitLab and Gitea shapes). */
function reason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Json
  const detail = Array.isArray(b.errors) ? (b.errors as Json[]).map((e) => e?.message).find(Boolean) : null
  const message = Array.isArray(b.message) ? b.message.join(', ') : b.message
  // Bitbucket: { type: 'error', error: { message } }
  const nested = b.error && typeof b.error === 'object' ? (b.error as Json).message : undefined
  return String(detail ?? message ?? nested ?? '') || null
}

async function request(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  fetchFn: FetchFn,
  send?: { method: 'POST' | 'PATCH' | 'PUT'; body: Json }
): Promise<unknown> {
  const base = apiBase(provider, host)
  if (!base) throw new Error('This provider has no API support')
  const headers: Record<string, string> = { 'User-Agent': 'Leviathan', ...authHeaders(provider, token) }
  if (send) headers['Content-Type'] = 'application/json'
  let res: Awaited<ReturnType<FetchFn>>
  try {
    res = await fetchFn(
      base + path,
      send ? { headers, method: send.method, body: JSON.stringify(send.body) } : { headers }
    )
  } catch (err) {
    // An invalid header value is quoted in the error: never let the token through.
    const detail = (err instanceof Error ? err.message : String(err)).split(token).join('…')
    throw new Error(`Could not reach ${host}: ${detail}`)
  }
  if (res.status === 401 || res.status === 403) {
    const label = `${LABELS[provider]} rejected the token (${res.status})`
    throw new Error(
      send
        ? `${label}. It needs permission to change pull requests (GitHub: repo, GitLab: api, Bitbucket: write:pullrequest:bitbucket).`
        : label
    )
  }
  if (!res.ok) {
    const why = send ? reason(await res.json().catch(() => null)) : null
    throw new Error(`${LABELS[provider]} answered with an error (${res.status})${why ? `: ${why}` : ''}`)
  }
  return res.json()
}

function getJson(provider: Provider, host: string, path: string, token: string, fetchFn: FetchFn) {
  return request(provider, host, path, token, fetchFn) as Promise<Json | Json[]>
}

/** API path of a project: GitLab takes the whole (URL-encoded) path as one id. */
function projectPath(provider: Provider, path: string): string {
  if (provider === 'gitlab') return `/projects/${encodeURIComponent(path)}`
  return provider === 'bitbucket' ? `/repositories/${path}` : `/repos/${path}`
}

/** The items of a Bitbucket page (`{ values: [...] }`), or the array other providers answer with. */
function items(body: unknown): Json[] {
  if (Array.isArray(body)) return body as Json[]
  const values = body && typeof body === 'object' ? (body as Json).values : null
  return Array.isArray(values) ? (values as Json[]) : []
}

function toPullRequest(provider: Provider, r: Json): PullRequest {
  const at = (o: unknown, key: string) => (o && typeof o === 'object' ? (o as Json)[key] : undefined)
  if (provider === 'bitbucket') {
    const from = at(at(r.source, 'repository'), 'full_name')
    const to = at(at(r.destination, 'repository'), 'full_name')
    return {
      number: Number(r.id),
      title: String(r.title ?? ''),
      author: String(at(r.author, 'display_name') ?? at(r.author, 'nickname') ?? ''),
      sourceBranch: String(at(at(r.source, 'branch'), 'name') ?? ''),
      targetBranch: String(at(at(r.destination, 'branch'), 'name') ?? ''),
      draft: Boolean(r.draft),
      url: String(at(at(r.links, 'html'), 'href') ?? ''),
      fromFork: !from || from !== to,
      updatedAt: String(r.updated_on ?? '')
    }
  }
  if (provider === 'gitlab') {
    return {
      number: Number(r.iid),
      title: String(r.title ?? ''),
      author: String(at(r.author, 'username') ?? ''),
      sourceBranch: String(r.source_branch ?? ''),
      targetBranch: String(r.target_branch ?? ''),
      draft: Boolean(r.draft ?? r.work_in_progress),
      url: String(r.web_url ?? ''),
      fromFork: r.source_project_id !== r.target_project_id,
      updatedAt: String(r.updated_at ?? '')
    }
  }
  const headRepo = at(at(r.head, 'repo'), 'full_name')
  const baseRepo = at(at(r.base, 'repo'), 'full_name')
  return {
    number: Number(r.number),
    title: String(r.title ?? ''),
    author: String(at(r.user, 'login') ?? ''),
    sourceBranch: String(at(r.head, 'ref') ?? ''),
    targetBranch: String(at(r.base, 'ref') ?? ''),
    draft: Boolean(r.draft),
    url: String(r.html_url ?? ''),
    // A deleted fork has no repository: treat it as a fork, its branch is not in this repository.
    fromFork: !headRepo || headRepo !== baseRepo,
    updatedAt: String(r.updated_at ?? '')
  }
}

/** Open pull requests (merge requests on GitLab), most recently updated first. */
export async function listPullRequests(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  fetchFn: FetchFn = fetch
): Promise<PullRequest[]> {
  const query =
    provider === 'gitlab'
      ? '/merge_requests?state=opened&order_by=updated_at&per_page=50'
      : provider === 'github'
        ? '/pulls?state=open&sort=updated&direction=desc&per_page=50'
        : provider === 'bitbucket'
          ? '/pullrequests?state=OPEN&pagelen=50'
          : '/pulls?state=open&sort=recentupdate&limit=50'
  const body = await getJson(provider, host, projectPath(provider, path) + query, token, fetchFn)
  return items(body).map((r) => toPullRequest(provider, r))
}

/** Opens a pull request; GitLab and Gitea mark drafts with a title prefix. */
export async function createPullRequest(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  input: NewPullRequest,
  fetchFn: FetchFn = fetch
): Promise<PullRequest> {
  const draftTitle = input.draft ? `Draft: ${input.title}` : input.title
  const [endpoint, body]: [string, Json] =
    provider === 'gitlab'
      ? [
          '/merge_requests',
          { source_branch: input.source, target_branch: input.target, title: draftTitle, description: input.body }
        ]
      : provider === 'github'
        ? [
            '/pulls',
            { title: input.title, body: input.body, head: input.source, base: input.target, draft: input.draft }
          ]
        : provider === 'bitbucket'
          ? [
              '/pullrequests',
              {
                title: input.title,
                description: input.body,
                source: { branch: { name: input.source } },
                destination: { branch: { name: input.target } },
                draft: input.draft
              }
            ]
          : ['/pulls', { title: draftTitle, body: input.body, head: input.source, base: input.target }]
  const created = await request(provider, host, projectPath(provider, path) + endpoint, token, fetchFn, {
    method: 'POST',
    body
  })
  return toPullRequest(provider, created as Json)
}

/** One pull request, as the provider sees it now. */
export async function getPullRequest(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  number: number,
  fetchFn: FetchFn = fetch
): Promise<PullRequest> {
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid pull request number: ${number}`)
  const kind = provider === 'gitlab' ? 'merge_requests' : provider === 'bitbucket' ? 'pullrequests' : 'pulls'
  const body = await getJson(provider, host, `${projectPath(provider, path)}/${kind}/${number}`, token, fetchFn)
  return toPullRequest(provider, body as Json)
}

/** Closes a pull request without merging it. */
export async function closePullRequest(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  number: number,
  fetchFn: FetchFn = fetch
): Promise<void> {
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid pull request number: ${number}`)
  const project = projectPath(provider, path)
  if (provider === 'bitbucket') {
    // Bitbucket "declines" a pull request.
    await request(provider, host, `${project}/pullrequests/${number}/decline`, token, fetchFn, {
      method: 'POST',
      body: {}
    })
  } else if (provider === 'gitlab') {
    await request(provider, host, `${project}/merge_requests/${number}`, token, fetchFn, {
      method: 'PUT',
      body: { state_event: 'close' }
    })
  } else {
    await request(provider, host, `${project}/pulls/${number}`, token, fetchFn, {
      method: 'PATCH',
      body: { state: 'closed' }
    })
  }
}

/** The project's default branch (the usual target of a pull request). */
export async function defaultBranch(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  fetchFn: FetchFn = fetch
): Promise<string> {
  const project = (await getJson(provider, host, projectPath(provider, path), token, fetchFn)) as Json
  const main = project.mainbranch && typeof project.mainbranch === 'object' ? (project.mainbranch as Json).name : null
  return String(project.default_branch ?? main ?? '')
}

/** Who the token belongs to, with the provider's no-reply address as commit email. */
export async function fetchIdentity(
  provider: Provider,
  host: string,
  token: string,
  fetchFn: FetchFn = fetch
): Promise<{ username: string; name: string; email: string }> {
  const user = (await getJson(provider, host, '/user', token, fetchFn)) as Record<string, unknown>
  if (provider === 'bitbucket') return bitbucketIdentity(host, token, user, fetchFn)
  const username = String(provider === 'gitlab' ? user.username : user.login)
  const name = String((provider === 'gitea' ? user.full_name : user.name) || username)
  return { username, name, email: noreplyEmail(provider, host, Number(user.id), username) }
}

/** Repositories the account can access, most recently updated first. */
export async function listRepos(
  provider: Provider,
  host: string,
  token: string,
  fetchFn: FetchFn = fetch
): Promise<RemoteRepo[]> {
  if (provider === 'bitbucket') return bitbucketRepos(host, token, fetchFn)
  const path =
    provider === 'github'
      ? '/user/repos?per_page=100&sort=updated'
      : provider === 'gitlab'
        ? '/projects?membership=true&per_page=100&order_by=last_activity_at'
        : '/user/repos?limit=50'
  const items = (await getJson(provider, host, path, token, fetchFn)) as Record<string, unknown>[]
  return items.map((r) =>
    provider === 'gitlab'
      ? {
          fullName: String(r.path_with_namespace),
          cloneUrl: String(r.http_url_to_repo),
          private: r.visibility !== 'public',
          description: String(r.description ?? ''),
          updatedAt: String(r.last_activity_at ?? '')
        }
      : {
          fullName: String(r.full_name),
          cloneUrl: String(r.clone_url),
          private: Boolean(r.private),
          description: String(r.description ?? ''),
          updatedAt: String(r.updated_at ?? '')
        }
  )
}

/**
 * Bitbucket has no no-reply address: commits use the primary confirmed email when the token may read it
 * (read:user:bitbucket), otherwise the user types one. The username is the one git sees in remote URLs.
 */
async function bitbucketIdentity(
  host: string,
  token: string,
  user: Json,
  fetchFn: FetchFn
): Promise<{ username: string; name: string; email: string }> {
  const username = String(user.username ?? user.nickname ?? '')
  const name = String(user.display_name || username)
  let email = ''
  try {
    const emails = items(await getJson('bitbucket', host, '/user/emails?pagelen=100', token, fetchFn))
    const primary = emails.find((e) => e.is_primary && e.is_confirmed) ?? emails.find((e) => e.is_confirmed)
    email = String(primary?.email ?? '')
  } catch {
    // The token may not read emails: the commit email is asked for instead.
  }
  return { username, name, email }
}

/** Bitbucket lists repositories per workspace (the account-wide list is gone). */
async function bitbucketRepos(host: string, token: string, fetchFn: FetchFn): Promise<RemoteRepo[]> {
  const workspaces = items(await getJson('bitbucket', host, '/user/workspaces?pagelen=100', token, fetchFn))
    .map((w) => (w.workspace && typeof w.workspace === 'object' ? String((w.workspace as Json).slug ?? '') : ''))
    .filter(Boolean)
    .slice(0, 20)
  // No role filter: role=member only counts explicit access, which leaves out the repositories of a workspace
  // the user owns. Without it the list is every repository of the workspace the user can see.
  const pages = await Promise.all(
    workspaces.map((slug) =>
      getJson(
        'bitbucket',
        host,
        `/repositories/${encodeURIComponent(slug)}?sort=-updated_on&pagelen=100`,
        token,
        fetchFn
      )
    )
  )
  return pages
    .flatMap(items)
    .map((r) => {
      const links = r.links && typeof r.links === 'object' ? ((r.links as Json).clone as Json[] | undefined) : undefined
      const https = (links ?? []).find((l) => l.name === 'https')
      return {
        fullName: String(r.full_name),
        cloneUrl: String(https?.href ?? `https://${host}/${String(r.full_name)}.git`),
        private: Boolean(r.is_private),
        description: String(r.description ?? ''),
        updatedAt: String(r.updated_on ?? '')
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 100)
}
