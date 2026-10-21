import { apiBase, noreplyEmail } from '../../shared/providers'
import type { Provider, RemoteRepo } from '../../shared/types'

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> }
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

async function getJson(provider: Provider, host: string, path: string, token: string, fetchFn: FetchFn) {
  const base = apiBase(provider, host)
  if (!base) throw new Error('This provider has no API support')
  let res: Awaited<ReturnType<FetchFn>>
  try {
    res = await fetchFn(base + path, { headers: { 'User-Agent': 'Leviathan', ...authHeaders(provider, token) } })
  } catch (err) {
    // The token only travels in headers, so network error messages cannot contain it.
    throw new Error(`Could not reach ${host}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (res.status === 401 || res.status === 403)
    throw new Error(`${LABELS[provider]} rejected the token (${res.status})`)
  if (!res.ok) throw new Error(`${LABELS[provider]} answered with an error (${res.status})`)
  return res.json() as Promise<Record<string, unknown> | Record<string, unknown>[]>
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
