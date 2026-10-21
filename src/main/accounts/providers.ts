import { apiBase, noreplyEmail } from '../../shared/providers'
import type { NewPullRequest, Provider, PullRequest, RemoteRepo } from '../../shared/types'

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const LABELS: Record<Provider, string> = { github: 'GitHub', gitlab: 'GitLab', gitea: 'Gitea', other: 'The server' }

function authHeaders(provider: Provider, token: string): Record<string, string> {
  switch (provider) {
    case 'github':
      return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    case 'gitlab':
      return { 'PRIVATE-TOKEN': token }
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
  return String(detail ?? message ?? '') || null
}

async function request(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  fetchFn: FetchFn,
  post?: Json
): Promise<unknown> {
  const base = apiBase(provider, host)
  if (!base) throw new Error('This provider has no API support')
  const headers: Record<string, string> = { 'User-Agent': 'Leviathan', ...authHeaders(provider, token) }
  if (post) headers['Content-Type'] = 'application/json'
  let res: Awaited<ReturnType<FetchFn>>
  try {
    res = await fetchFn(base + path, post ? { headers, method: 'POST', body: JSON.stringify(post) } : { headers })
  } catch (err) {
    // An invalid header value is quoted in the error: never let the token through.
    const detail = (err instanceof Error ? err.message : String(err)).split(token).join('…')
    throw new Error(`Could not reach ${host}: ${detail}`)
  }
  if (res.status === 401 || res.status === 403) {
    const label = `${LABELS[provider]} rejected the token (${res.status})`
    throw new Error(post ? `${label}. It needs permission to create pull requests (GitHub: repo, GitLab: api).` : label)
  }
  if (!res.ok) {
    const why = post ? reason(await res.json().catch(() => null)) : null
    throw new Error(`${LABELS[provider]} answered with an error (${res.status})${why ? `: ${why}` : ''}`)
  }
  return res.json()
}

function getJson(provider: Provider, host: string, path: string, token: string, fetchFn: FetchFn) {
  return request(provider, host, path, token, fetchFn) as Promise<Json | Json[]>
}

/** API path of a project: GitLab takes the whole (URL-encoded) path as one id. */
function projectPath(provider: Provider, path: string): string {
  return provider === 'gitlab' ? `/projects/${encodeURIComponent(path)}` : `/repos/${path}`
}

function toPullRequest(provider: Provider, r: Json): PullRequest {
  const at = (o: unknown, key: string) => (o && typeof o === 'object' ? (o as Json)[key] : undefined)
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
        : '/pulls?state=open&sort=recentupdate&limit=50'
  const items = (await getJson(provider, host, projectPath(provider, path) + query, token, fetchFn)) as Json[]
  return items.map((r) => toPullRequest(provider, r))
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
        : ['/pulls', { title: draftTitle, body: input.body, head: input.source, base: input.target }]
  const created = await request(provider, host, projectPath(provider, path) + endpoint, token, fetchFn, body)
  return toPullRequest(provider, created as Json)
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
  return String(project.default_branch ?? '')
}

/** Who the token belongs to, with the provider's no-reply address as commit email. */
export async function fetchIdentity(
  provider: Provider,
  host: string,
  token: string,
  fetchFn: FetchFn = fetch
): Promise<{ username: string; name: string; email: string }> {
  const user = (await getJson(provider, host, '/user', token, fetchFn)) as Record<string, unknown>
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
