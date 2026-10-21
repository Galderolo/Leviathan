import { describe, expect, it } from 'vitest'
import {
  createPullRequest,
  defaultBranch,
  fetchIdentity,
  listPullRequests,
  listRepos,
  type FetchFn
} from '../src/main/accounts/providers'

const TOKEN = 'tok_secret_value'

/** Fake fetch that serves canned JSON per URL and records the request headers. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; headers: Record<string, string>; method?: string; body?: unknown }[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({
      url,
      headers: init?.headers ?? {},
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined
    })
    const route = routes[url]
    if (!route) return { ok: false, status: 404, json: async () => ({}) }
    const status = route.status ?? 200
    return { ok: status < 400, status, json: async () => route.body }
  }
  return { fn, calls }
}

describe('fetchIdentity', () => {
  it('reads a GitHub user and uses the no-reply email', async () => {
    const { fn, calls } = fakeFetch({ 'https://api.github.com/user': { body: { login: 'ana', id: 5, name: null } } })
    expect(await fetchIdentity('github', 'github.com', TOKEN, fn)).toEqual({
      username: 'ana',
      name: 'ana',
      email: '5+ana@users.noreply.github.com'
    })
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('reads a GitLab user', async () => {
    const { fn, calls } = fakeFetch({
      'https://gitlab.com/api/v4/user': { body: { username: 'bo', id: 9, name: 'Bo' } }
    })
    expect(await fetchIdentity('gitlab', 'gitlab.com', TOKEN, fn)).toEqual({
      username: 'bo',
      name: 'Bo',
      email: '9-bo@users.noreply.gitlab.com'
    })
    expect(calls[0].headers['PRIVATE-TOKEN']).toBe(TOKEN)
  })

  it('explains a rejected token without leaking it', async () => {
    const { fn } = fakeFetch({ 'https://api.github.com/user': { status: 401, body: { message: 'Bad credentials' } } })
    const error = await fetchIdentity('github', 'github.com', TOKEN, fn).catch((e: Error) => e)
    expect((error as Error).message).toBe('GitHub rejected the token (401)')
    expect((error as Error).message).not.toContain(TOKEN)
    const { fn: gl } = fakeFetch({ 'https://gitlab.com/api/v4/user': { status: 401, body: {} } })
    await expect(fetchIdentity('gitlab', 'gitlab.com', TOKEN, gl)).rejects.toThrow('GitLab rejected the token (401)')
  })
})

describe('listRepos', () => {
  it('maps GitHub repositories', async () => {
    const { fn } = fakeFetch({
      'https://api.github.com/user/repos?per_page=100&sort=updated': {
        body: [
          {
            full_name: 'ana/app',
            clone_url: 'https://github.com/ana/app.git',
            private: true,
            description: null,
            updated_at: '2026-10-01T00:00:00Z'
          }
        ]
      }
    })
    expect(await listRepos('github', 'github.com', TOKEN, fn)).toEqual([
      {
        fullName: 'ana/app',
        cloneUrl: 'https://github.com/ana/app.git',
        private: true,
        description: '',
        updatedAt: '2026-10-01T00:00:00Z'
      }
    ])
  })

  it('maps GitLab projects', async () => {
    const { fn } = fakeFetch({
      'https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at': {
        body: [
          {
            path_with_namespace: 'bo/tool',
            http_url_to_repo: 'https://gitlab.com/bo/tool.git',
            visibility: 'internal',
            description: 'A tool',
            last_activity_at: '2026-09-01T00:00:00Z'
          }
        ]
      }
    })
    expect(await listRepos('gitlab', 'gitlab.com', TOKEN, fn)).toEqual([
      {
        fullName: 'bo/tool',
        cloneUrl: 'https://gitlab.com/bo/tool.git',
        private: true,
        description: 'A tool',
        updatedAt: '2026-09-01T00:00:00Z'
      }
    ])
  })
})

describe('pull requests', () => {
  const ghPr = {
    number: 7,
    title: 'Fix login',
    user: { login: 'ana' },
    head: { ref: 'fix', repo: { full_name: 'ana/app' } },
    base: { ref: 'main', repo: { full_name: 'org/app' } },
    draft: false,
    html_url: 'https://github.com/org/app/pull/7',
    updated_at: '2026-10-01T00:00:00Z'
  }
  const ghExpected = {
    number: 7,
    title: 'Fix login',
    author: 'ana',
    sourceBranch: 'fix',
    targetBranch: 'main',
    draft: false,
    url: 'https://github.com/org/app/pull/7',
    fromFork: true,
    updatedAt: '2026-10-01T00:00:00Z'
  }
  const glPath = encodeURIComponent('group/sub/app')

  it('lists GitHub pull requests, marking the ones from forks', async () => {
    const { fn } = fakeFetch({
      'https://api.github.com/repos/org/app/pulls?state=open&sort=updated&direction=desc&per_page=50': { body: [ghPr] }
    })
    expect(await listPullRequests('github', 'github.com', 'org/app', TOKEN, fn)).toEqual([ghExpected])
  })

  it('lists GitLab merge requests of a project in a subgroup', async () => {
    const { fn } = fakeFetch({
      [`https://gitlab.com/api/v4/projects/${glPath}/merge_requests?state=opened&order_by=updated_at&per_page=50`]: {
        body: [
          {
            iid: 3,
            title: 'Draft: New page',
            author: { username: 'bo' },
            source_branch: 'page',
            target_branch: 'main',
            draft: true,
            web_url: 'https://gitlab.com/group/sub/app/-/merge_requests/3',
            source_project_id: 10,
            target_project_id: 10,
            updated_at: '2026-10-02T00:00:00Z'
          }
        ]
      }
    })
    expect(await listPullRequests('gitlab', 'gitlab.com', 'group/sub/app', TOKEN, fn)).toEqual([
      {
        number: 3,
        title: 'Draft: New page',
        author: 'bo',
        sourceBranch: 'page',
        targetBranch: 'main',
        draft: true,
        url: 'https://gitlab.com/group/sub/app/-/merge_requests/3',
        fromFork: false,
        updatedAt: '2026-10-02T00:00:00Z'
      }
    ])
  })

  it('lists Gitea pull requests', async () => {
    const { fn } = fakeFetch({
      'https://git.example.com/api/v1/repos/org/app/pulls?state=open&sort=recentupdate&limit=50': { body: [ghPr] }
    })
    expect(await listPullRequests('gitea', 'git.example.com', 'org/app', TOKEN, fn)).toEqual([ghExpected])
  })

  it('creates a draft pull request on GitHub', async () => {
    const { fn, calls } = fakeFetch({ 'https://api.github.com/repos/org/app/pulls': { status: 201, body: ghPr } })
    const input = { title: 'Fix login', body: 'Details', source: 'fix', target: 'main', draft: true }
    expect(await createPullRequest('github', 'github.com', 'org/app', TOKEN, input, fn)).toEqual(ghExpected)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ title: 'Fix login', body: 'Details', head: 'fix', base: 'main', draft: true })
  })

  it('creates a draft merge request on GitLab with the Draft prefix', async () => {
    const { fn, calls } = fakeFetch({
      [`https://gitlab.com/api/v4/projects/${glPath}/merge_requests`]: {
        status: 201,
        body: { iid: 4, title: 'Draft: Page', author: { username: 'bo' }, source_branch: 'page', target_branch: 'main' }
      }
    })
    const input = { title: 'Page', body: 'Text', source: 'page', target: 'main', draft: true }
    await createPullRequest('gitlab', 'gitlab.com', 'group/sub/app', TOKEN, input, fn)
    expect(calls[0].body).toEqual({
      source_branch: 'page',
      target_branch: 'main',
      title: 'Draft: Page',
      description: 'Text'
    })
  })

  it('says which permission the token lacks, without leaking it', async () => {
    const { fn } = fakeFetch({ 'https://api.github.com/repos/org/app/pulls': { status: 403, body: {} } })
    const input = { title: 'T', body: '', source: 'fix', target: 'main', draft: false }
    const error = (await createPullRequest('github', 'github.com', 'org/app', TOKEN, input, fn).catch(
      (e) => e
    )) as Error
    expect(error.message).toMatch(/permission/)
    expect(error.message).toMatch(/GitLab: api/)
    expect(error.message).not.toContain(TOKEN)
  })

  it("passes on the provider's reason when it refuses a pull request", async () => {
    const { fn } = fakeFetch({
      'https://api.github.com/repos/org/app/pulls': {
        status: 422,
        body: { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for ana:fix.' }] }
      }
    })
    const input = { title: 'T', body: '', source: 'fix', target: 'main', draft: false }
    await expect(createPullRequest('github', 'github.com', 'org/app', TOKEN, input, fn)).rejects.toThrow(
      /already exists/
    )
  })

  it('reads the default branch', async () => {
    const { fn } = fakeFetch({
      'https://api.github.com/repos/org/app': { body: { default_branch: 'develop' } },
      [`https://gitlab.com/api/v4/projects/${glPath}`]: { body: { default_branch: 'trunk' } }
    })
    expect(await defaultBranch('github', 'github.com', 'org/app', TOKEN, fn)).toBe('develop')
    expect(await defaultBranch('gitlab', 'gitlab.com', 'group/sub/app', TOKEN, fn)).toBe('trunk')
  })
})

describe('network errors', () => {
  it('never repeat the token, even when the error quotes a header', async () => {
    const fn: FetchFn = async (_url, init) => {
      throw new Error(`Headers.append: "${init?.headers?.Authorization}" is an invalid header value.`)
    }
    const error = (await fetchIdentity('github', 'github.com', TOKEN, fn).catch((e) => e)) as Error
    expect(error.message).toMatch(/Could not reach github.com/)
    expect(error.message).not.toContain(TOKEN)
  })
})
