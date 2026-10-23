import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { FetchFn } from './providers'

// GitLab.com refuses the device flow to this application, so the sign-in goes through the browser and comes back
// to a local address registered with the application (authorization code with PKCE: no secret in the app).

/** An access token and what renews it; GitLab's access tokens last two hours. */
export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  /** Unix milliseconds. */
  expiresAt: number
}

const SCOPES = 'api read_user write_repository'

function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`
}

const base64url = (data: Buffer) => data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The PKCE challenge for a verifier (S256). */
export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

/** A new random verifier, and a state that ties the browser's answer to this sign-in. */
export function newSignIn(): { verifier: string; state: string } {
  return { verifier: base64url(randomBytes(32)), state: base64url(randomBytes(16)) }
}

export function authorizeUrl(opts: {
  host: string
  clientId: string
  port: number
  state: string
  challenge: string
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: redirectUri(opts.port),
    response_type: 'code',
    state: opts.state,
    scope: SCOPES,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256'
  })
  return `https://${opts.host}/oauth/authorize?${params}`
}

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Leviathan</title>` +
  `<body style="font-family:system-ui,sans-serif;margin:4em auto;max-width:32em;text-align:center">` +
  `<h2>Leviathan</h2><p>${message}</p></body>`

/**
 * Listens on 127.0.0.1:`port` until the browser comes back from GitLab with the code of this sign-in (`state`).
 * Other requests get an error and the wait goes on; it ends after 10 minutes, or when `signal` aborts.
 */
export function waitForRedirect(
  port: number,
  state: string,
  signal?: AbortSignal,
  /** Called once the address listens: the browser can be sent to GitLab. */
  onListening?: () => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGE('This is not the sign-in Leviathan is waiting for. Start it again from Leviathan.'))
        return
      }
      const code = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (code) {
        // Neutral: the code still has to be traded for tokens, and Leviathan tells how that went.
        res.end(PAGE('GitLab answered. You can close this tab and go back to Leviathan.'))
        finish(() => resolve(code))
      } else {
        res.end(PAGE('The sign-in was not completed. You can close this tab.'))
        finish(() => reject(new Error('The sign-in was denied on GitLab')))
      }
    })
    const timer = setTimeout(
      () => finish(() => reject(new Error('The sign-in took too long. Start it again.'))),
      10 * 60 * 1000
    )
    const onAbort = () => finish(() => reject(new Error('Sign-in cancelled')))
    function finish(settle: () => void) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      server.close()
      server.closeAllConnections()
      settle()
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    server.once('error', (err: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          err.code === 'EADDRINUSE'
            ? new Error(
                `Another program is using port ${port}, which the GitLab sign-in needs. Close it and try again.`
              )
            : err
        )
      )
    )
    server.listen(port, '127.0.0.1', onListening)
  })
}

async function tokenRequest(
  host: string,
  form: Record<string, string>,
  /** What to say when GitLab refuses the code or the renewal token (`invalid_grant`). */
  refused: string,
  fetchFn: FetchFn,
  now: number
) {
  let res: Awaited<ReturnType<FetchFn>>
  try {
    res = await fetchFn(`https://${host}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Leviathan'
      },
      body: new URLSearchParams(form).toString()
    })
  } catch (err) {
    throw new Error(`Could not reach GitLab: ${err instanceof Error ? err.message : String(err)}`)
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    if (body.error === 'invalid_grant') throw new Error(refused)
    throw new Error(`GitLab refused the sign-in (${String(body.error ?? res.status)})`)
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + Number(body.expires_in ?? 7200) * 1000
  }
}

/** Trades the code the browser brought back for tokens. */
export function exchangeCode(
  opts: { host: string; clientId: string; port: number; code: string; verifier: string },
  fetchFn: FetchFn = fetch,
  now = Date.now()
): Promise<OAuthTokens> {
  return tokenRequest(
    opts.host,
    {
      client_id: opts.clientId,
      grant_type: 'authorization_code',
      code: opts.code,
      code_verifier: opts.verifier,
      redirect_uri: redirectUri(opts.port)
    },
    'GitLab did not accept the sign-in. Start it again.',
    fetchFn,
    now
  )
}

/** New tokens before the access token expires; GitLab replaces the renewal token too. */
export function refreshTokens(
  opts: { host: string; clientId: string; refreshToken: string },
  fetchFn: FetchFn = fetch,
  now = Date.now()
): Promise<OAuthTokens> {
  return tokenRequest(
    opts.host,
    { client_id: opts.clientId, grant_type: 'refresh_token', refresh_token: opts.refreshToken },
    'The GitLab sign-in has expired or was revoked: sign in again (Settings → Accounts).',
    fetchFn,
    now
  )
}
