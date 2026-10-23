import { apiBase, mergeMethods, noreplyEmail } from '../../shared/providers'
import type {
  MergeMethod,
  NewPullRequest,
  Provider,
  PullRequest,
  PullRequestComment,
  RemoteRepo
} from '../../shared/types'

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
  // GitHub sends `errors` as objects with a message, or as plain strings.
  const detail = Array.isArray(b.errors)
    ? (b.errors as unknown[]).map((e) => (typeof e === 'string' ? e : (e as Json | null)?.message)).find(Boolean)
    : null
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
    const body = await res.json().catch(() => null)
    const why = reason(body)
    // A refused change (approving twice, merging without the right to) is not a bad token: say what the server said.
    if (send && why && provider !== 'bitbucket') throw new Error(`${LABELS[provider]} refused (${res.status}): ${why}`)
    const label = `${LABELS[provider]} rejected the token (${res.status})${provider === 'bitbucket' ? missingScopes(body) : ''}`
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
  // A change may be answered with no body at all (Gitea's merge, a 204).
  return send ? res.json().catch(() => null) : res.json()
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
          ? '/pullrequests?state=OPEN&sort=-updated_on&pagelen=50'
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
  // A nickname is no username (git refuses it): without one, the user types it.
  const username = String(user.username ?? '')
  const name = String(user.display_name || user.nickname || username)
  let email = ''
  try {
    const emails = items(await getJson('bitbucket', host, '/user/emails?pagelen=100', token, fetchFn))
    const primary = emails.find((e) => e.is_primary && e.is_confirmed) ?? emails.find((e) => e.is_confirmed)
    email = String(primary?.email ?? '')
  } catch (err) {
    // Only a token that may not read emails falls back to asking for one; any other failure is reported.
    if (!/rejected the token/.test(err instanceof Error ? err.message : '')) throw err
  }
  return { username, name, email }
}

/** Bitbucket lists repositories per workspace (the account-wide list is gone). */
async function bitbucketRepos(host: string, token: string, fetchFn: FetchFn): Promise<RemoteRepo[]> {
  const workspaces = items(await getJson('bitbucket', host, '/user/workspaces?pagelen=100', token, fetchFn))
    .map((w) => (w.workspace && typeof w.workspace === 'object' ? String((w.workspace as Json).slug ?? '') : ''))
    .filter(Boolean)
    .slice(0, 50)
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
      return {
        fullName: String(r.full_name),
        // Not Bitbucket's clone link, which carries the username: git would use it over the account bound to the
        // repository (a rebind, a username typed in the form, a colleague's link).
        cloneUrl: `https://${host}/${String(r.full_name)}.git`,
        private: Boolean(r.is_private),
        description: String(r.description ?? ''),
        updatedAt: String(r.updated_on ?? '')
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 100)
}

/** Bitbucket's reason for refusing a token, with the permissions it lacks (`error.detail.required`). */
function missingScopes(answer: unknown): string {
  const body = answer && typeof answer === 'object' ? (answer as Json) : null
  const error = body?.error && typeof body.error === 'object' ? (body.error as Json) : null
  if (!error) return ''
  const detail = error.detail && typeof error.detail === 'object' ? (error.detail as Json) : null
  const required = Array.isArray(detail?.required) ? (detail!.required as unknown[]).map(String) : []
  const message = typeof error.message === 'string' ? error.message : ''
  if (required.length) return `: it needs ${required.join(', ')}`
  return message ? `: ${message}` : ''
}

// ---------------------------------------------------------------------------
// Reviewing a pull request: its conversation, approving and merging it.

const at = (o: unknown, key: string): unknown => (o && typeof o === 'object' ? (o as Json)[key] : undefined)

function assertNumber(number: number): void {
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid pull request number: ${number}`)
}

function toComment(provider: Provider, c: Json): PullRequestComment {
  const comment = (author: unknown, body: unknown, createdAt: unknown, path?: unknown, line?: unknown) => ({
    id: String(c.id),
    author: String(author ?? ''),
    body: String(body ?? ''),
    createdAt: String(createdAt ?? ''),
    ...(typeof path === 'string' && path ? { path } : {}),
    ...(typeof line === 'number' ? { line } : {})
  })
  switch (provider) {
    case 'gitlab': {
      const position = c.position
      return comment(
        at(c.author, 'username'),
        c.body,
        c.created_at,
        at(position, 'new_path'),
        at(position, 'new_line') ?? at(position, 'old_line')
      )
    }
    case 'bitbucket':
      return comment(
        at(c.user, 'display_name') ?? at(c.user, 'nickname'),
        at(c.content, 'raw'),
        c.created_on,
        at(c.inline, 'path'),
        at(c.inline, 'to') ?? at(c.inline, 'from')
      )
    default:
      return comment(at(c.user, 'login'), c.body, c.created_at, c.path, c.line ?? c.original_line)
  }
}

/** A pull request's comments, oldest first: general ones and those on lines of its files. */
export async function listPullRequestComments(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  number: number,
  fetchFn: FetchFn = fetch
): Promise<PullRequestComment[]> {
  assertNumber(number)
  const project = projectPath(provider, path)
  const get = (route: string) => getJson(provider, host, project + route, token, fetchFn)
  let comments: Json[]
  switch (provider) {
    case 'github': {
      const [general, inline, reviews] = await Promise.all([
        get(`/issues/${number}/comments?per_page=100`),
        get(`/pulls/${number}/comments?per_page=100`),
        get(`/pulls/${number}/reviews?per_page=100`)
      ])
      // Three lists with ids of their own; reviews count when they say something ("Request changes: …").
      comments = [
        ...items(general).map((c) => ({ ...c, id: `issue-${c.id}` })),
        ...items(inline).map((c) => ({ ...c, id: `line-${c.id}` })),
        ...items(reviews)
          .filter((r) => typeof r.body === 'string' && r.body.trim())
          .map((r) => ({ ...r, id: `review-${r.id}`, created_at: r.submitted_at }))
      ]
      break
    }
    case 'gitlab':
      // Newest first, so a busy merge request keeps its latest comments within the page; system notes ("added 1
      // commit", "approved this merge request") are not part of the conversation.
      comments = items(await get(`/merge_requests/${number}/notes?per_page=100&sort=desc&order_by=created_at`)).filter(
        (n) => !n.system
      )
      break
    case 'bitbucket':
      // Deleted comments, and pending ones (drafts of a review not sent yet).
      comments = items(await get(`/pullrequests/${number}/comments?pagelen=100`)).filter(
        (c) => !c.deleted && !c.pending
      )
      break
    default:
      comments = items(await get(`/issues/${number}/comments?limit=50`))
  }
  return comments.map((c) => toComment(provider, c)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Adds a general comment to a pull request. */
export async function addPullRequestComment(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  number: number,
  body: string,
  fetchFn: FetchFn = fetch
): Promise<PullRequestComment> {
  assertNumber(number)
  const project = projectPath(provider, path)
  const [route, payload]: [string, Json] =
    provider === 'gitlab'
      ? [`/merge_requests/${number}/notes`, { body }]
      : provider === 'bitbucket'
        ? [`/pullrequests/${number}/comments`, { content: { raw: body } }]
        : [`/issues/${number}/comments`, { body }]
  const created = await request(provider, host, project + route, token, fetchFn, { method: 'POST', body: payload })
  return toComment(provider, created as Json)
}

function assertCommit(head: string): void {
  if (!/^[0-9a-f]{7,64}$/i.test(head)) throw new Error(`Invalid commit: "${head}"`)
}

/** Bitbucket takes no commit with an approval or a merge: check its pull request is still at the reviewed one. */
async function assertBitbucketHead(
  host: string,
  project: string,
  token: string,
  number: number,
  head: string,
  fetchFn: FetchFn
) {
  const pr = (await getJson('bitbucket', host, `${project}/pullrequests/${number}`, token, fetchFn)) as Json
  const now = String(at(at(pr.source, 'commit'), 'hash') ?? '')
  if (!now || !head.toLowerCase().startsWith(now.toLowerCase())) throw new Error(CHANGED_SINCE_REVIEW)
}

const CHANGED_SINCE_REVIEW =
  'The pull request changed since the review opened: open it again to see its latest version.'

/** Approves a pull request as the account, at `head`, the commit the review showed. */
export async function approvePullRequest(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  number: number,
  head: string,
  fetchFn: FetchFn = fetch
): Promise<void> {
  assertNumber(number)
  assertCommit(head)
  const project = projectPath(provider, path)
  if (provider === 'bitbucket') await assertBitbucketHead(host, project, token, number, head, fetchFn)
  // The commit goes along, so the provider refuses when the pull request moved on since the review.
  const [route, payload]: [string, Json] =
    provider === 'gitlab'
      ? [`/merge_requests/${number}/approve`, { sha: head }]
      : provider === 'bitbucket'
        ? [`/pullrequests/${number}/approve`, {}]
        : [`/pulls/${number}/reviews`, { event: provider === 'github' ? 'APPROVE' : 'APPROVED', commit_id: head }]
  await request(provider, host, project + route, token, fetchFn, { method: 'POST', body: payload })
}

/**
 * Merges a pull request on the provider (it needs to be mergeable there: approvals, checks, no conflicts), only
 * while it is still at `head`, the commit the review showed.
 */
export async function mergePullRequest(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  number: number,
  method: MergeMethod,
  head: string,
  fetchFn: FetchFn = fetch
): Promise<void> {
  assertNumber(number)
  assertCommit(head)
  const project = projectPath(provider, path)
  switch (provider) {
    case 'github':
      await request(provider, host, `${project}/pulls/${number}/merge`, token, fetchFn, {
        method: 'PUT',
        body: { merge_method: method, sha: head }
      })
      return
    case 'gitlab':
      if (method === 'rebase')
        throw new Error('GitLab merges with a merge commit or a squash: rebase the branch first.')
      await request(provider, host, `${project}/merge_requests/${number}/merge`, token, fetchFn, {
        method: 'PUT',
        body: { squash: method === 'squash', sha: head }
      })
      return
    case 'bitbucket': {
      await assertBitbucketHead(host, project, token, number, head, fetchFn)
      const strategy = { merge: 'merge_commit', squash: 'squash', rebase: 'rebase_fast_forward' }[method]
      await request(provider, host, `${project}/pullrequests/${number}/merge`, token, fetchFn, {
        method: 'POST',
        body: { merge_strategy: strategy }
      })
      return
    }
    default:
      await request(provider, host, `${project}/pulls/${number}/merge`, token, fetchFn, {
        method: 'POST',
        body: { Do: method, head_commit_id: head }
      })
  }
}

/** `methods` with `preset` (a provider's default, when it is one of them) first. */
function presetFirst(methods: MergeMethod[], preset: MergeMethod | undefined): MergeMethod[] {
  return preset && methods.includes(preset) ? [preset, ...methods.filter((m) => m !== preset)] : methods
}

/** The merge methods the project's settings allow, its default first (unknown settings allow them all). */
async function projectMergeMethods(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  targetBranch: string,
  fetchFn: FetchFn
): Promise<MergeMethod[]> {
  const all = mergeMethods(provider)
  const project = projectPath(provider, path)
  switch (provider) {
    case 'github': {
      const repo = (await getJson(provider, host, project, token, fetchFn)) as Json
      const flags = { merge: 'allow_merge_commit', squash: 'allow_squash_merge', rebase: 'allow_rebase_merge' }
      return all.filter((m) => repo[flags[m]] !== false)
    }
    case 'gitlab': {
      // Merging takes a squash flag: whether there is a choice is the project's squash setting.
      const repo = (await getJson(provider, host, project, token, fetchFn)) as Json
      switch (repo.squash_option) {
        case 'never':
          return ['merge']
        case 'always':
          return ['squash']
        case 'default_on':
          return ['squash', 'merge']
        default:
          return ['merge', 'squash']
      }
    }
    case 'bitbucket': {
      // Strategies are set per target branch (branch restrictions), with the repository's as fallback.
      const name = targetBranch.split('/').map(encodeURIComponent).join('/')
      const branch = (await getJson(provider, host, `${project}/refs/branches/${name}`, token, fetchFn)) as Json
      if (!Array.isArray(branch.merge_strategies)) return all
      const ours: Record<string, MergeMethod> = {
        merge_commit: 'merge',
        squash: 'squash',
        rebase_fast_forward: 'rebase'
      }
      const allowed = all.filter((m) => (branch.merge_strategies as unknown[]).some((s) => ours[String(s)] === m))
      return presetFirst(allowed, ours[String(branch.default_merge_strategy)])
    }
    default: {
      const repo = (await getJson(provider, host, project, token, fetchFn)) as Json
      const flags = { merge: 'allow_merge_commits', squash: 'allow_squash_merge', rebase: 'allow_rebase' }
      const allowed = all.filter((m) => repo[flags[m]] !== false)
      return presetFirst(
        allowed,
        all.find((m) => m === repo.default_merge_style)
      )
    }
  }
}

/**
 * The ways a pull request into `targetBranch` can merge, as the project allows, its default first: GitHub's
 * `allow_*_merge`, GitLab's squash setting, the target branch's strategies on Bitbucket, Gitea's merge styles.
 * Settings the token cannot read, or none the app knows, offer every method: the server still refuses when it must.
 */
export async function allowedMergeMethods(
  provider: Provider,
  host: string,
  path: string,
  token: string,
  targetBranch: string,
  fetchFn: FetchFn = fetch
): Promise<MergeMethod[]> {
  const all = mergeMethods(provider)
  try {
    const allowed = await projectMergeMethods(provider, host, path, token, targetBranch, fetchFn)
    return allowed.length ? allowed : all
  } catch {
    return all
  }
}
