import type { FetchFn } from './providers'

/** What the user needs to authorize the app, and what the app polls with. */
export interface DeviceCode {
  deviceCode: string
  /** Short code the user types at `verificationUri`. */
  userCode: string
  verificationUri: string
  /** Seconds the code stays valid. */
  expiresIn: number
  /** Seconds to wait between polls. */
  interval: number
}

const GITHUB = 'https://github.com'

/** GitHub could not be reached, or failed on its side (5xx): worth asking again in a moment. */
class Unreachable extends Error {}

/** Unreachable answers in a row while waiting for the user before the sign-in gives up. */
const RETRIES = 3

async function post(path: string, form: Record<string, string>, fetchFn: FetchFn): Promise<Record<string, unknown>> {
  let res: Awaited<ReturnType<FetchFn>>
  try {
    res = await fetchFn(GITHUB + path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Leviathan'
      },
      body: new URLSearchParams(form).toString()
    })
  } catch (err) {
    throw new Unreachable(`Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    const error = `GitHub answered with an error (${res.status})`
    throw res.status >= 500 ? new Unreachable(error) : new Error(error)
  }
  return (await res.json()) as Record<string, unknown>
}

/** Starts GitHub's device flow: a code for the user to enter on github.com. */
export async function startDeviceFlow(clientId: string, scope: string, fetchFn: FetchFn = fetch): Promise<DeviceCode> {
  const body = await post('/login/device/code', { client_id: clientId, scope }, fetchFn)
  if (!body.device_code || !body.user_code)
    throw new Error(`GitHub did not start the sign-in (${body.error ?? 'no code'})`)
  return {
    deviceCode: String(body.device_code),
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri ?? `${GITHUB}/login/device`),
    expiresIn: Number(body.expires_in ?? 900),
    interval: Number(body.interval ?? 5)
  }
}

/**
 * Waits for the user to authorize the code in the browser and returns the
 * access token. Polls at GitHub's pace (slower when it says so) until the code
 * is authorized, denied or expired, or `signal` aborts.
 */
export async function pollDeviceFlow(
  clientId: string,
  code: DeviceCode,
  opts: { fetchFn?: FetchFn; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal } = {}
): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch
  const cancelled = () => new Error('Sign-in cancelled')
  // Waits between polls, cut short by a cancel.
  const sleep =
    opts.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        opts.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(cancelled())
          },
          { once: true }
        )
      }))
  let interval = code.interval
  let failures = 0
  for (;;) {
    await sleep(interval * 1000)
    if (opts.signal?.aborted) throw cancelled()
    let body: Record<string, unknown>
    try {
      body = await post(
        '/login/oauth/access_token',
        {
          client_id: clientId,
          device_code: code.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        },
        fetchFn
      )
    } catch (err) {
      // A dropped connection while the user types the code: ask again, unless it keeps failing.
      if (!(err instanceof Unreachable) || ++failures >= RETRIES) throw err
      continue
    }
    failures = 0
    if (opts.signal?.aborted) throw cancelled()
    if (typeof body.access_token === 'string' && body.access_token) return body.access_token
    switch (body.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval = Number(body.interval) || interval + 5
        continue
      case 'access_denied':
        throw new Error('The sign-in was denied on GitHub')
      case 'expired_token':
        throw new Error('The code expired before it was entered. Start the sign-in again.')
      default:
        throw new Error(`GitHub refused the sign-in (${String(body.error ?? 'unknown error')})`)
    }
  }
}
