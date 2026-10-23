import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  codeChallenge,
  exchangeCode,
  refreshTokens,
  waitForRedirect
} from '../src/main/accounts/gitlabOAuth'
import type { FetchFn } from '../src/main/accounts/providers'

function fakeFetch(answer: { status?: number; body: unknown }) {
  const calls: { url: string; init?: Parameters<FetchFn>[1] }[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    const status = answer.status ?? 200
    return { ok: status < 400, status, json: async () => answer.body }
  }
  return { fn, calls }
}

const get = (port: number, path: string) => fetch(`http://127.0.0.1:${port}${path}`)

/** Starts waiting for the browser and returns once the local address listens. */
async function listening(port: number, state: string, signal?: AbortSignal): Promise<{ result: Promise<string> }> {
  let ready!: () => void
  const up = new Promise<void>((resolve) => (ready = resolve))
  const result = waitForRedirect(port, state, signal, ready)
  result.catch(() => {})
  await Promise.race([up, result])
  // Wrapped: an async function returning a promise would wait for it.
  return { result }
}

describe('GitLab sign-in (authorization code with PKCE)', () => {
  it('derives the code challenge as RFC 7636 does', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('sends the user to the authorize page with the app, the scopes and the challenge', () => {
    const url = new URL(
      authorizeUrl({ host: 'gitlab.com', clientId: 'app1', port: 47231, state: 'st', challenge: 'ch' })
    )
    expect(url.origin + url.pathname).toBe('https://gitlab.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'app1',
      redirect_uri: 'http://127.0.0.1:47231/callback',
      response_type: 'code',
      state: 'st',
      scope: 'api read_user write_repository',
      code_challenge: 'ch',
      code_challenge_method: 'S256'
    })
  })

  it('waits on 127.0.0.1 for the browser to come back with the code of this sign-in only', async () => {
    const port = 47300 + Math.floor(Math.random() * 500)
    const { result: waiting } = await listening(port, 'good-state')
    expect((await get(port, '/other')).status).toBe(404)
    expect((await get(port, '/callback?code=stolen&state=bad')).status).toBe(400)
    const page = await get(port, '/callback?code=the-code&state=good-state')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Leviathan')
    expect(await waiting).toBe('the-code')
    // The port is free again.
    await expect(get(port, '/callback')).rejects.toThrow()
  })

  it('reports a sign-in refused in the browser, and stops when cancelled', async () => {
    const port = 47800 + Math.floor(Math.random() * 100)
    const { result: refused } = await listening(port, 's')
    await get(port, '/callback?error=access_denied&state=s')
    await expect(refused).rejects.toThrow('denied')

    const controller = new AbortController()
    const { result: cancelled } = await listening(port, 's', controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toThrow('cancelled')
  })

  it('says so when the port is taken by another program', async () => {
    const port = 47950 + Math.floor(Math.random() * 40)
    await listening(port, 'a', AbortSignal.timeout(2000))
    await expect(waitForRedirect(port, 'b')).rejects.toThrow(String(port))
  })

  it('trades the code for tokens that expire, and renews them', async () => {
    const tokens = { access_token: 'A1', refresh_token: 'R1', expires_in: 7200, token_type: 'Bearer' }
    const { fn, calls } = fakeFetch({ body: tokens })
    const now = 1_000_000
    expect(
      await exchangeCode({ host: 'gitlab.com', clientId: 'app1', port: 47231, code: 'c', verifier: 'v' }, fn, now)
    ).toEqual({ accessToken: 'A1', refreshToken: 'R1', expiresAt: now + 7200 * 1000 })
    expect(calls[0].url).toBe('https://gitlab.com/oauth/token')
    expect(Object.fromEntries(new URLSearchParams(calls[0].init!.body))).toEqual({
      client_id: 'app1',
      grant_type: 'authorization_code',
      code: 'c',
      code_verifier: 'v',
      redirect_uri: 'http://127.0.0.1:47231/callback'
    })

    await refreshTokens({ host: 'gitlab.com', clientId: 'app1', refreshToken: 'R0' }, fn, now)
    expect(Object.fromEntries(new URLSearchParams(calls[1].init!.body))).toEqual({
      client_id: 'app1',
      grant_type: 'refresh_token',
      refresh_token: 'R0'
    })
  })

  it('asks to sign in again when GitLab no longer accepts the renewal', async () => {
    const { fn } = fakeFetch({ status: 400, body: { error: 'invalid_grant' } })
    await expect(refreshTokens({ host: 'gitlab.com', clientId: 'app1', refreshToken: 'R0' }, fn)).rejects.toThrow(
      'sign in again'
    )
  })

  it('asks to start again when GitLab refuses the code the browser brought back', async () => {
    const { fn } = fakeFetch({ status: 400, body: { error: 'invalid_grant' } })
    const exchange = exchangeCode({ host: 'gitlab.com', clientId: 'app1', port: 1, code: 'c', verifier: 'v' }, fn)
    await expect(exchange).rejects.toThrow('GitLab did not accept the sign-in. Start it again.')
  })
})
