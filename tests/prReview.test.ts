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

function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  const fn: FetchFn = async (url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined })
    const key = `${method} ${url}`
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => routes[key] }
  }
  return { fn, calls }
}

describe('GitHub pull request conversation', () => {
  const base = 'https://api.github.com/repos/org/app'
  it('lists general and line comments in the order they were written', async () => {
    const { fn } = fakeFetch({
      [`GET ${base}/issues/7/comments?per_page=100`]: [
        { id: 1, user: { login: 'ana' }, body: 'Looks good', created_at: '2026-10-20T10:00:00Z' }
      ],
      [`GET ${base}/pulls/7/comments?per_page=100`]: [
        { id: 2, user: { login: 'bo' }, body: 'Typo', created_at: '2026-10-20T09:00:00Z', path: 'a.cs', line: 12 }
      ]
    })
    expect(await listPullRequestComments('github', 'github.com', 'org/app', TOKEN, 7, fn)).toEqual([
      { id: '2', author: 'bo', body: 'Typo', createdAt: '2026-10-20T09:00:00Z', path: 'a.cs', line: 12 },
      { id: '1', author: 'ana', body: 'Looks good', createdAt: '2026-10-20T10:00:00Z' }
    ])
  })

  it('comments, approves and merges', async () => {
    const { fn, calls } = fakeFetch({
      [`POST ${base}/issues/7/comments`]: {
        id: 3,
        user: { login: 'me' },
        body: 'Thanks',
        created_at: '2026-10-21T00:00:00Z'
      },
      [`POST ${base}/pulls/7/reviews`]: {},
      [`PUT ${base}/pulls/7/merge`]: { merged: true }
    })
    expect(await addPullRequestComment('github', 'github.com', 'org/app', TOKEN, 7, 'Thanks', fn)).toMatchObject({
      author: 'me',
      body: 'Thanks'
    })
    await approvePullRequest('github', 'github.com', 'org/app', TOKEN, 7, fn)
    await mergePullRequest('github', 'github.com', 'org/app', TOKEN, 7, 'squash', fn)
    expect(calls.map((c) => [c.method, c.url.slice(base.length), c.body])).toEqual([
      ['POST', '/issues/7/comments', { body: 'Thanks' }],
      ['POST', '/pulls/7/reviews', { event: 'APPROVE' }],
      ['PUT', '/pulls/7/merge', { merge_method: 'squash' }]
    ])
  })
})

describe('GitLab merge request conversation', () => {
  const base = 'https://gitlab.com/api/v4/projects/group%2Fapp'
  it('leaves out system notes, and merges with or without squash only', async () => {
    const { fn, calls } = fakeFetch({
      [`GET ${base}/merge_requests/7/notes?per_page=100&sort=asc`]: [
        { id: 5, author: { username: 'ana' }, body: 'ok', created_at: '2026-10-20T10:00:00Z', system: false },
        {
          id: 6,
          author: { username: 'ana' },
          body: 'added 1 commit',
          created_at: '2026-10-20T10:01:00Z',
          system: true
        },
        {
          id: 7,
          author: { username: 'bo' },
          body: 'Here',
          created_at: '2026-10-20T10:02:00Z',
          system: false,
          position: { new_path: 'a.cs', new_line: 3 }
        }
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
    await approvePullRequest('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, fn)
    await mergePullRequest('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, 'squash', fn)
    expect(calls.slice(1).map((c) => [c.method, c.url.slice(base.length), c.body])).toEqual([
      ['POST', '/merge_requests/7/notes', { body: 'Done' }],
      ['POST', '/merge_requests/7/approve', {}],
      ['PUT', '/merge_requests/7/merge', { squash: true }]
    ])
    await expect(mergePullRequest('gitlab', 'gitlab.com', 'group/app', TOKEN, 7, 'rebase', fn)).rejects.toThrow(
      'GitLab'
    )
    expect(mergeMethods('gitlab')).toEqual(['merge', 'squash'])
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
    await approvePullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, fn)
    await mergePullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, 'rebase', fn)
    expect(calls.slice(1).map((c) => [c.method, c.url.slice(base.length), c.body])).toEqual([
      ['POST', '/pullrequests/7/comments', { content: { raw: 'Done' } }],
      ['POST', '/pullrequests/7/approve', {}],
      ['POST', '/pullrequests/7/merge', { merge_strategy: 'rebase_fast_forward' }]
    ])
    expect(mergeMethods('bitbucket')).toEqual(['merge', 'squash', 'rebase'])
  })
})

describe('Gitea pull request conversation', () => {
  const base = 'https://git.acme.com/api/v1/repos/org/app'
  it('comments, approves and merges', async () => {
    const { fn, calls } = fakeFetch({
      [`GET ${base}/issues/7/comments`]: [{ id: 1, user: { login: 'ana' }, body: 'x', created_at: 'y' }],
      [`POST ${base}/issues/7/comments`]: { id: 2, user: { login: 'me' }, body: 'Done', created_at: 'z' },
      [`POST ${base}/pulls/7/reviews`]: {},
      [`POST ${base}/pulls/7/merge`]: {}
    })
    expect(await listPullRequestComments('gitea', 'git.acme.com', 'org/app', TOKEN, 7, fn)).toEqual([
      { id: '1', author: 'ana', body: 'x', createdAt: 'y' }
    ])
    await addPullRequestComment('gitea', 'git.acme.com', 'org/app', TOKEN, 7, 'Done', fn)
    await approvePullRequest('gitea', 'git.acme.com', 'org/app', TOKEN, 7, fn)
    await mergePullRequest('gitea', 'git.acme.com', 'org/app', TOKEN, 7, 'merge', fn)
    expect(calls.slice(1).map((c) => [c.method, c.url.slice(base.length), c.body])).toEqual([
      ['POST', '/issues/7/comments', { body: 'Done' }],
      ['POST', '/pulls/7/reviews', { event: 'APPROVED' }],
      ['POST', '/pulls/7/merge', { Do: 'merge' }]
    ])
  })
})
