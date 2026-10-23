import { describe, expect, it } from 'vitest'
import {
  addPullRequestComment,
  approvePullRequest,
  listPullRequestComments,
  mergePullRequest,
  type FetchFn
} from '../src/main/accounts/providers'
import { mergeMethods } from '../src/shared/providers'

const TOKEN = 'tok_secret_value'
/** The commit the review showed. */
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
/** A route answering with an empty body (json() throws), as some providers do after a write. */
const EMPTY = Symbol('empty')

function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  const fn: FetchFn = async (url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined })
    const key = `${method} ${url}`
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}) }
    const answer = routes[key] as { status?: number; body?: unknown } | unknown
    const framed = answer && typeof answer === 'object' && 'status' in answer
    const status = framed ? (answer as unknown as { status: number }).status : 200
    const body = framed ? (answer as unknown as { body: unknown }).body : answer
    return {
      ok: status < 400,
      status,
      json: async () => {
        if (body === EMPTY) throw new SyntaxError('Unexpected end of JSON input')
        return body
      }
    }
  }
  return { fn, calls }
}

const writes = (calls: { url: string; method: string; body?: unknown }[], base: string) =>
  calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url.slice(base.length), c.body])

describe('GitHub pull request conversation', () => {
  const base = 'https://api.github.com/repos/org/app'
  it('lists general and line comments and review summaries in the order they were written', async () => {
    const { fn } = fakeFetch({
      [`GET ${base}/issues/7/comments?per_page=100`]: [
        { id: 1, user: { login: 'ana' }, body: 'Looks good', created_at: '2026-10-20T10:00:00Z' }
      ],
      [`GET ${base}/pulls/7/comments?per_page=100`]: [
        { id: 1, user: { login: 'bo' }, body: 'Typo', created_at: '2026-10-20T09:00:00Z', path: 'a.cs', line: 12 }
      ],
      [`GET ${base}/pulls/7/reviews?per_page=100`]: [
        { id: 4, user: { login: 'cy' }, body: 'Please rename it', submitted_at: '2026-10-20T09:30:00Z' },
        // An approval without words adds nothing to read.
        { id: 5, user: { login: 'cy' }, body: '', submitted_at: '2026-10-20T11:00:00Z' }
      ]
    })
    const comments = await listPullRequestComments('github', 'github.com', 'org/app', TOKEN, 7, fn)
    expect(comments.map((c) => [c.author, c.body, c.path ?? null, c.line ?? null])).toEqual([
      ['bo', 'Typo', 'a.cs', 12],
      ['cy', 'Please rename it', null, null],
      ['ana', 'Looks good', null, null]
    ])
    // Ids from different lists stay apart (they key the rows).
    expect(new Set(comments.map((c) => c.id)).size).toBe(3)
  })

  it('approves and merges the commit that was reviewed', async () => {
    const { fn, calls } = fakeFetch({
      [`POST ${base}/issues/7/comments`]: { id: 3, user: { login: 'me' }, body: 'Thanks', created_at: 'x' },
      [`POST ${base}/pulls/7/reviews`]: {},
      [`PUT ${base}/pulls/7/merge`]: { merged: true }
    })
    expect(await addPullRequestComment('github', 'github.com', 'org/app', TOKEN, 7, 'Thanks', fn)).toMatchObject({
      author: 'me',
      body: 'Thanks'
    })
    await approvePullRequest('github', 'github.com', 'org/app', TOKEN, 7, HEAD, fn)
    await mergePullRequest('github', 'github.com', 'org/app', TOKEN, 7, 'squash', HEAD, fn)
    expect(writes(calls, base)).toEqual([
      ['POST', '/issues/7/comments', { body: 'Thanks' }],
      ['POST', '/pulls/7/reviews', { event: 'APPROVE', commit_id: HEAD }],
      ['PUT', '/pulls/7/merge', { merge_method: 'squash', sha: HEAD }]
    ])
  })

  it("shows GitHub's reason for refusing", async () => {
    const { fn } = fakeFetch({
      [`POST ${base}/pulls/7/reviews`]: {
        status: 422,
        body: { message: 'Unprocessable Entity', errors: ['Can not approve your own pull request'] }
      }
    })
    await expect(approvePullRequest('github', 'github.com', 'org/app', TOKEN, 7, HEAD, fn)).rejects.toThrow(
      'Can not approve your own pull request'
    )
  })
})

describe('GitLab merge request conversation', () => {
  const base = 'https://gitlab.com/api/v4/projects/group%2Fapp'
  it('keeps the newest notes without system ones, and merges the reviewed commit with or without squash', async () => {
    const { fn, calls } = fakeFetch({
      // Newest first, so a busy merge request keeps its latest comments within the page.
      [`GET ${base}/merge_requests/7/notes?per_page=100&sort=desc&order_by=created_at`]: [
        {
          id: 7,
          author: { username: 'bo' },
          body: 'Here',
          created_at: '2026-10-20T10:02:00Z',
          system: false,
          position: { new_path: 'a.cs', new_line: 3 }
        },
        {
          id: 6,
          author: { username: 'ana' },
          body: 'added 1 commit',
          created_at: '2026-10-20T10:01:00Z',
          system: true
        },
        { id: 5, author: { username: 'ana' }, body: 'ok', created_at: '2026-10-20T10:00:00Z', system: false }
      ],
      [`POST ${base}/merge_requests/7/notes`]: { id: 8, author: { username: 'me' }, body: 'Done', created_at: 'x' },
      [`POST ${base}/merge_requests/7/approve`]: {},
      [`PUT ${base}/merge_requests/7/merge`]: {}
    })
    expect(await listPullRequestComments('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, fn)).toEqual([
      { id: '5', author: 'ana', body: 'ok', createdAt: '2026-10-20T10:00:00Z' },
      { id: '7', author: 'bo', body: 'Here', createdAt: '2026-10-20T10:02:00Z', path: 'a.cs', line: 3 }
    ])
    await addPullRequestComment('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, 'Done', fn)
    await approvePullRequest('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, HEAD, fn)
    await mergePullRequest('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, 'squash', HEAD, fn)
    expect(writes(calls, base)).toEqual([
      ['POST', '/merge_requests/7/notes', { body: 'Done' }],
      ['POST', '/merge_requests/7/approve', { sha: HEAD }],
      ['PUT', '/merge_requests/7/merge', { squash: true, sha: HEAD }]
    ])
    await expect(mergePullRequest('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, 'rebase', HEAD, fn)).rejects.toThrow(
      'GitLab'
    )
    expect(mergeMethods('gitlab')).toEqual(['merge', 'squash'])
  })

  it("passes on GitLab's reason when it refuses an approval, instead of blaming the token", async () => {
    const { fn } = fakeFetch({
      [`POST ${base}/merge_requests/7/approve`]: { status: 401, body: { message: 'You already approved it' } }
    })
    const error = await approvePullRequest('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, HEAD, fn).catch((e) => e)
    expect(String(error.message)).toContain('You already approved it')
    expect(String(error.message)).not.toContain('rejected the token')
  })
})

describe('Bitbucket pull request conversation', () => {
  const base = 'https://api.bitbucket.org/2.0/repositories/studio/game'
  it('lists comments without deleted or pending ones, and maps the merge strategies', async () => {
    const { fn, calls } = fakeFetch({
      [`GET ${base}/pullrequests/7/comments?pagelen=100`]: {
        values: [
          {
            id: 9,
            user: { display_name: 'Ana' },
            content: { raw: 'Fix this' },
            created_on: '2026-10-20T10:00:00Z',
            inline: { path: 'a.cs', to: 4 }
          },
          { id: 10, user: { display_name: 'Ana' }, content: { raw: '' }, created_on: 'x', deleted: true },
          { id: 11, user: { display_name: 'Me' }, content: { raw: 'draft' }, created_on: 'x', pending: true }
        ]
      },
      [`GET ${base}/pullrequests/7`]: { id: 7, source: { commit: { hash: HEAD.slice(0, 12) } } },
      [`POST ${base}/pullrequests/7/comments`]: {
        id: 12,
        user: { display_name: 'Me' },
        content: { raw: 'Done' },
        created_on: '2026-10-21T00:00:00Z'
      },
      [`POST ${base}/pullrequests/7/approve`]: {},
      [`POST ${base}/pullrequests/7/merge`]: {}
    })
    expect(await listPullRequestComments('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, fn)).toEqual([
      { id: '9', author: 'Ana', body: 'Fix this', createdAt: '2026-10-20T10:00:00Z', path: 'a.cs', line: 4 }
    ])
    await addPullRequestComment('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, 'Done', fn)
    await approvePullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, HEAD, fn)
    await mergePullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, 'rebase', HEAD, fn)
    expect(writes(calls, base)).toEqual([
      ['POST', '/pullrequests/7/comments', { content: { raw: 'Done' } }],
      ['POST', '/pullrequests/7/approve', {}],
      ['POST', '/pullrequests/7/merge', { merge_strategy: 'rebase_fast_forward' }]
    ])
    expect(mergeMethods('bitbucket')).toEqual(['merge', 'squash', 'rebase'])
  })

  it('refuses to approve or merge when the pull request moved on since the review', async () => {
    const { fn, calls } = fakeFetch({
      [`GET ${base}/pullrequests/7`]: { id: 7, source: { commit: { hash: '999999999999' } } },
      [`POST ${base}/pullrequests/7/approve`]: {},
      [`POST ${base}/pullrequests/7/merge`]: {}
    })
    await expect(approvePullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, HEAD, fn)).rejects.toThrow(
      'changed'
    )
    await expect(
      mergePullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, 'merge', HEAD, fn)
    ).rejects.toThrow('changed')
    expect(writes(calls, base)).toEqual([])
  })
})

describe('Gitea pull request conversation', () => {
  const base = 'https://git.acme.com/api/v1/repos/org/app'
  it('comments, approves and merges the reviewed commit, taking an empty answer as success', async () => {
    const { fn, calls } = fakeFetch({
      [`GET ${base}/issues/7/comments?limit=50`]: [{ id: 1, user: { login: 'ana' }, body: 'x', created_at: 'y' }],
      [`POST ${base}/issues/7/comments`]: { id: 2, user: { login: 'me' }, body: 'Done', created_at: 'z' },
      [`POST ${base}/pulls/7/reviews`]: {},
      [`POST ${base}/pulls/7/merge`]: EMPTY
    })
    expect(await listPullRequestComments('gitea', 'git.acme.com', 'org/app', TOKEN, 7, fn)).toEqual([
      { id: '1', author: 'ana', body: 'x', createdAt: 'y' }
    ])
    await addPullRequestComment('gitea', 'git.acme.com', 'org/app', TOKEN, 7, 'Done', fn)
    await approvePullRequest('gitea', 'git.acme.com', 'org/app', TOKEN, 7, HEAD, fn)
    await mergePullRequest('gitea', 'git.acme.com', 'org/app', TOKEN, 7, 'merge', HEAD, fn)
    expect(writes(calls, base)).toEqual([
      ['POST', '/issues/7/comments', { body: 'Done' }],
      ['POST', '/pulls/7/reviews', { event: 'APPROVED', commit_id: HEAD }],
      ['POST', '/pulls/7/merge', { Do: 'merge', head_commit_id: HEAD }]
    ])
  })
})
