import { describe, expect, it } from 'vitest'
import {
  canPush,
  authorAvatar,
  closePullRequest,
  createPullRequest,
  defaultBranch,
  fetchIdentity,
  listPullRequests,
  listRepos,
  PULL_REQUESTS_MAX,
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
    // Bearer takes both personal access tokens and the tokens of a GitLab sign-in.
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
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
      'https://api.github.com/repos/org/app/pulls?state=open&sort=updated&direction=desc&per_page=100': { body: [ghPr] }
    })
    expect(await listPullRequests('github', 'github.com', 'org/app', TOKEN, fn)).toEqual([ghExpected])
  })

  it('asks for the next pages while they are full, once for each pull request', async () => {
    const prs = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ ...ghPr, number: from + i }))
    const list = 'https://api.github.com/repos/org/app/pulls?state=open&sort=updated&direction=desc&per_page=100'
    const { fn, calls } = fakeFetch({
      [list]: { body: prs(1, 100) },
      // Pull request 100 was updated meanwhile: it moved to the first page, and 1 slid into this one.
      [`${list}&page=2`]: { body: prs(100, 1).concat(prs(101, 99)) },
      [`${list}&page=3`]: { body: prs(200, 3) }
    })
    const listed = await listPullRequests('github', 'github.com', 'org/app', TOKEN, fn)
    expect(listed.map((pr) => pr.number)).toEqual(prs(1, 202).map((pr) => pr.number))
    expect(calls).toHaveLength(3)
  })

  it(`stops at ${PULL_REQUESTS_MAX} pull requests`, async () => {
    const list = 'https://api.github.com/repos/org/app/pulls?state=open&sort=updated&direction=desc&per_page=100'
    const fn: FetchFn = async (url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? 1)
      const body = Array.from({ length: 100 }, (_, i) => ({ ...ghPr, number: (page - 1) * 100 + i + 1 }))
      return { ok: url.startsWith(list), status: 200, json: async () => body }
    }
    expect(await listPullRequests('github', 'github.com', 'org/app', TOKEN, fn)).toHaveLength(PULL_REQUESTS_MAX)
  })

  it('lists GitLab merge requests of a project in a subgroup', async () => {
    const { fn } = fakeFetch({
      [`https://gitlab.com/api/v4/projects/${glPath}/merge_requests?state=opened&order_by=updated_at&per_page=100`]: {
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

describe('closePullRequest', () => {
  const glPath = encodeURIComponent('group/sub/app')

  it('closes it with the method and body each provider expects', async () => {
    const gh = fakeFetch({ 'https://api.github.com/repos/org/app/pulls/7': { body: {} } })
    await closePullRequest('github', 'github.com', 'org/app', TOKEN, 7, gh.fn)
    expect(gh.calls[0]).toMatchObject({ method: 'PATCH', body: { state: 'closed' } })

    const gl = fakeFetch({ [`https://gitlab.com/api/v4/projects/${glPath}/merge_requests/3`]: { body: {} } })
    await closePullRequest('gitlab', 'gitlab.com', 'group/sub/app', TOKEN, 3, gl.fn)
    expect(gl.calls[0]).toMatchObject({ method: 'PUT', body: { state_event: 'close' } })

    const gt = fakeFetch({ 'https://git.example.com/api/v1/repos/org/app/pulls/5': { body: {} } })
    await closePullRequest('gitea', 'git.example.com', 'org/app', TOKEN, 5, gt.fn)
    expect(gt.calls[0]).toMatchObject({ method: 'PATCH', body: { state: 'closed' } })
  })

  it('says when the token may not change pull requests', async () => {
    const { fn } = fakeFetch({ 'https://api.github.com/repos/org/app/pulls/7': { status: 401, body: {} } })
    await expect(closePullRequest('github', 'github.com', 'org/app', TOKEN, 7, fn)).rejects.toThrow(
      /rejected the token \(401\)\. It needs permission/
    )
  })

  // A 403 is a refusal: the account may lack the role on the project as well as the token its permission.
  it('does not blame the token alone for a refusal without a reason', async () => {
    const { fn } = fakeFetch({ 'https://api.github.com/repos/org/app/pulls/7': { status: 403, body: {} } })
    const error = await closePullRequest('github', 'github.com', 'org/app', TOKEN, 7, fn).catch((e: Error) => e)
    expect((error as Error).message).not.toContain('rejected the token')
    expect((error as Error).message).toMatch(/role on this project/)
    expect((error as Error).message).toMatch(/permission/)
  })
})

describe('Bitbucket Cloud', () => {
  const API = 'https://api.bitbucket.org/2.0'
  const pr = (id: number, source: string, fromRepo = 'studio/game') => ({
    id,
    title: `PR ${id}`,
    author: { display_name: 'Ana Pérez', nickname: 'ana' },
    source: { branch: { name: source }, repository: { full_name: fromRepo } },
    destination: { branch: { name: 'develop' }, repository: { full_name: 'studio/game' } },
    draft: false,
    links: { html: { href: `https://bitbucket.org/studio/game/pull-requests/${id}` } },
    updated_on: '2026-10-20T10:00:00Z'
  })

  it('reads the user with the primary confirmed email (Bitbucket has no no-reply address)', async () => {
    const { fn, calls } = fakeFetch({
      [`${API}/user`]: { body: { username: 'dcervera1', display_name: 'David', nickname: 'dc', account_id: 'x' } },
      [`${API}/user/emails?pagelen=100`]: {
        body: {
          values: [
            { email: 'old@studio.example', is_primary: false, is_confirmed: true },
            { email: 'david@studio.example', is_primary: true, is_confirmed: true }
          ]
        }
      }
    })
    expect(await fetchIdentity('bitbucket', 'bitbucket.org', TOKEN, fn)).toEqual({
      username: 'dcervera1',
      name: 'David',
      email: 'david@studio.example'
    })
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('leaves out an email the token may not read, and a username Bitbucket does not give (a nickname is no username)', async () => {
    const { fn } = fakeFetch({
      [`${API}/user`]: { body: { nickname: 'dc', display_name: '' } },
      [`${API}/user/emails?pagelen=100`]: { status: 403, body: {} }
    })
    expect(await fetchIdentity('bitbucket', 'bitbucket.org', TOKEN, fn)).toEqual({
      username: '',
      name: 'dc',
      email: ''
    })
  })

  it('lists the repositories of every workspace, most recently updated first', async () => {
    const repo = (name: string, updated: string) => ({
      full_name: name,
      is_private: true,
      description: '',
      updated_on: updated,
      links: {
        clone: [
          { name: 'ssh', href: `git@bitbucket.org:${name}.git` },
          { name: 'https', href: `https://dcervera1@bitbucket.org/${name}.git` }
        ]
      }
    })
    const { fn } = fakeFetch({
      [`${API}/user/workspaces?pagelen=100`]: {
        body: { values: [{ workspace: { slug: 'studio' } }, { workspace: { slug: 'me' } }] }
      },
      [`${API}/repositories/studio?sort=-updated_on&pagelen=100`]: {
        body: { values: [repo('studio/game', '2026-10-01T00:00:00Z')] }
      },
      [`${API}/repositories/me?sort=-updated_on&pagelen=100`]: {
        body: { values: [repo('me/tool', '2026-10-05T00:00:00Z')] }
      }
    })
    expect(await listRepos('bitbucket', 'bitbucket.org', TOKEN, fn)).toEqual([
      {
        fullName: 'me/tool',
        cloneUrl: 'https://bitbucket.org/me/tool.git',
        private: true,
        description: '',
        updatedAt: '2026-10-05T00:00:00Z'
      },
      {
        fullName: 'studio/game',
        cloneUrl: 'https://bitbucket.org/studio/game.git',
        private: true,
        description: '',
        updatedAt: '2026-10-01T00:00:00Z'
      }
    ])
  })

  it('lists, opens, declines pull requests and reads the main branch', async () => {
    const base = `${API}/repositories/studio/game`
    const { fn, calls } = fakeFetch({
      [`${base}/pullrequests?state=OPEN&sort=-updated_on&pagelen=50`]: {
        body: { values: [pr(7, 'feature/x'), pr(8, 'fix/y', 'ana/game')] }
      },
      [`${base}/pullrequests`]: { body: pr(9, 'feature/z') },
      [`${base}/pullrequests/7/decline`]: { body: pr(7, 'feature/x') },
      [base]: { body: { mainbranch: { name: 'develop' } } }
    })
    expect(await listPullRequests('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, fn)).toEqual([
      {
        number: 7,
        title: 'PR 7',
        author: 'Ana Pérez',
        sourceBranch: 'feature/x',
        targetBranch: 'develop',
        draft: false,
        url: 'https://bitbucket.org/studio/game/pull-requests/7',
        fromFork: false,
        updatedAt: '2026-10-20T10:00:00Z'
      },
      expect.objectContaining({ number: 8, fromFork: true })
    ])

    const input = { title: 'Z', body: 'why', source: 'feature/z', target: 'develop', draft: true }
    expect((await createPullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, input, fn)).number).toBe(9)
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: {
        title: 'Z',
        description: 'why',
        source: { branch: { name: 'feature/z' } },
        destination: { branch: { name: 'develop' } },
        draft: true
      }
    })

    await closePullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, 7, fn)
    expect(calls[2]).toMatchObject({ url: `${base}/pullrequests/7/decline`, method: 'POST' })
    expect(await defaultBranch('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, fn)).toBe('develop')
  })

  it('does not take a server error for a token that cannot read emails', async () => {
    const { fn } = fakeFetch({
      [`${API}/user`]: { body: { username: 'dcervera1', display_name: 'David' } },
      [`${API}/user/emails?pagelen=100`]: { status: 500, body: {} }
    })
    await expect(fetchIdentity('bitbucket', 'bitbucket.org', TOKEN, fn)).rejects.toThrow('(500)')
  })

  it('names the permission a token lacks', async () => {
    const { fn } = fakeFetch({
      [`${API}/user/workspaces?pagelen=100`]: {
        status: 403,
        body: {
          type: 'error',
          error: {
            message: 'Your credentials lack one or more required privilege scopes.',
            detail: { granted: ['read:user:bitbucket'], required: ['read:workspace:bitbucket'] }
          }
        }
      }
    })
    await expect(listRepos('bitbucket', 'bitbucket.org', TOKEN, fn)).rejects.toThrow('read:workspace:bitbucket')
  })

  it("shows Bitbucket's own explanation of an error", async () => {
    const { fn } = fakeFetch({
      'https://api.bitbucket.org/2.0/repositories/studio/game/pullrequests': {
        status: 400,
        body: { type: 'error', error: { message: 'There are no changes to be pulled' } }
      }
    })
    const input = { title: 'Z', body: '', source: 'develop', target: 'develop', draft: false }
    await expect(createPullRequest('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, input, fn)).rejects.toThrow(
      'There are no changes to be pulled'
    )
  })
})

describe('canPush', () => {
  it('reads the push permission GitHub and Gitea give the token on a repository', async () => {
    const github = fakeFetch({ 'https://api.github.com/repos/studio/game': { body: { permissions: { push: true } } } })
    expect(await canPush('github', 'github.com', 'studio/game', TOKEN, github.fn)).toBe(true)
    const readOnly = fakeFetch({
      'https://api.github.com/repos/studio/game': { body: { permissions: { push: false } } }
    })
    expect(await canPush('github', 'github.com', 'studio/game', TOKEN, readOnly.fn)).toBe(false)
    const gitea = fakeFetch({
      'https://git.example.com/api/v1/repos/studio/game': { body: { permissions: { push: true } } }
    })
    expect(await canPush('gitea', 'git.example.com', 'studio/game', TOKEN, gitea.fn)).toBe(true)
  })

  it('counts GitLab developers and above, by project or by group', async () => {
    const url = 'https://gitlab.com/api/v4/projects/studio%2Fgame'
    const level = (project: number | null, group: number | null) =>
      fakeFetch({
        [url]: {
          body: {
            permissions: {
              project_access: project === null ? null : { access_level: project },
              group_access: group === null ? null : { access_level: group }
            }
          }
        }
      }).fn
    expect(await canPush('gitlab', 'gitlab.com', 'studio/game', TOKEN, level(30, null))).toBe(true)
    expect(await canPush('gitlab', 'gitlab.com', 'studio/game', TOKEN, level(null, 40))).toBe(true)
    expect(await canPush('gitlab', 'gitlab.com', 'studio/game', TOKEN, level(20, 10))).toBe(false)
  })

  it('asks Bitbucket for the permission of the user on the repository', async () => {
    const url =
      'https://api.bitbucket.org/2.0/user/permissions/repositories?q=' +
      encodeURIComponent('repository.full_name="studio/game"')
    const as = (permission: string) => fakeFetch({ [url]: { body: { values: [{ permission }] } } }).fn
    expect(await canPush('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, as('write'))).toBe(true)
    expect(await canPush('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, as('admin'))).toBe(true)
    expect(await canPush('bitbucket', 'bitbucket.org', 'studio/game', TOKEN, as('read'))).toBe(false)
  })

  it('is false when the server does not show the repository, or cannot be reached', async () => {
    expect(await canPush('github', 'github.com', 'studio/game', TOKEN, fakeFetch({}).fn)).toBe(false)
    const down: FetchFn = async () => {
      throw new Error('offline')
    }
    expect(await canPush('github', 'github.com', 'studio/game', TOKEN, down)).toBe(false)
    expect(await canPush('other', 'example.com', 'studio/game', TOKEN, fakeFetch({}).fn)).toBe(false)
  })
})

describe('authorAvatar', () => {
  const author = { hash: 'abc123', email: 'dee@work.example' }
  const picture = 'https://avatars.example/dee.png'

  it("gives the picture of the user a commit's author belongs to, on GitHub, Gitea and Bitbucket", async () => {
    const github = fakeFetch({
      'https://api.github.com/repos/studio/game/commits/abc123': { body: { author: { avatar_url: picture } } }
    })
    expect(await authorAvatar('github', 'github.com', 'studio/game', author, TOKEN, github.fn)).toBe(picture)
    const gitea = fakeFetch({
      'https://git.example.com/api/v1/repos/studio/game/git/commits/abc123': {
        body: { author: { avatar_url: picture } }
      }
    })
    expect(await authorAvatar('gitea', 'git.example.com', 'studio/game', author, TOKEN, gitea.fn)).toBe(picture)
    const bitbucket = fakeFetch({
      'https://api.bitbucket.org/2.0/repositories/studio/game/commit/abc123': {
        body: { author: { raw: 'Dee <dee@work.example>', user: { links: { avatar: { href: picture } } } } }
      }
    })
    expect(await authorAvatar('bitbucket', 'bitbucket.org', 'studio/game', author, TOKEN, bitbucket.fn)).toBe(picture)
  })

  it('asks GitLab for the picture of an email', async () => {
    const { fn } = fakeFetch({
      [`https://gitlab.com/api/v4/avatar?email=${encodeURIComponent('dee@work.example')}&size=64`]: {
        body: { avatar_url: picture }
      }
    })
    expect(await authorAvatar('gitlab', 'gitlab.com', 'studio/game', author, TOKEN, fn)).toBe(picture)
  })

  it('is null when the author is no user there, the commit cannot be read, or the server has no API', async () => {
    const noUser = fakeFetch({ 'https://api.github.com/repos/studio/game/commits/abc123': { body: { author: null } } })
    expect(await authorAvatar('github', 'github.com', 'studio/game', author, TOKEN, noUser.fn)).toBeNull()
    const noBitbucketUser = fakeFetch({
      'https://api.bitbucket.org/2.0/repositories/studio/game/commit/abc123': { body: { author: { raw: 'Dee' } } }
    })
    expect(
      await authorAvatar('bitbucket', 'bitbucket.org', 'studio/game', author, TOKEN, noBitbucketUser.fn)
    ).toBeNull()
    expect(await authorAvatar('github', 'github.com', 'studio/game', author, TOKEN, fakeFetch({}).fn)).toBeNull()
    const other = fakeFetch({})
    expect(await authorAvatar('other', 'example.com', 'studio/game', author, TOKEN, other.fn)).toBeNull()
    expect(other.calls).toEqual([])
  })
})
