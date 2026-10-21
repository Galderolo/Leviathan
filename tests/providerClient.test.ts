import { describe, expect, it } from 'vitest'
import { fetchIdentity, listRepos, type FetchFn } from '../src/main/accounts/providers'

const TOKEN = 'tok_secret_value'

/** Fake fetch that serves canned JSON per URL and records the request headers. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} })
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
