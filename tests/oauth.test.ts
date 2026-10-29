import { describe, expect, it } from 'vitest'
import { pollDeviceFlow, startDeviceFlow, type DeviceCode } from '../src/main/accounts/oauth'
import type { FetchFn } from '../src/main/accounts/providers'

const CLIENT = 'client-id'
const TOKEN = 'gho_secret_token_value'

/** Fake fetch answering each call with the next canned body; records what was sent. */
function scripted(bodies: unknown[]) {
  const calls: { url: string; body: Record<string, string>; headers: Record<string, string> }[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init?.body)), headers: init?.headers ?? {} })
    const body = bodies.shift()
    return { ok: true, status: 200, json: async () => body }
  }
  return { fn, calls }
}

const code: DeviceCode = {
  deviceCode: 'dev-123',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5
}

describe('startDeviceFlow', () => {
  it('asks GitHub for a code with the client id and scopes', async () => {
    const { fn, calls } = scripted([
      {
        device_code: 'dev-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      }
    ])
    expect(await startDeviceFlow(CLIENT, 'repo read:user', fn)).toEqual(code)
    expect(calls[0].url).toBe('https://github.com/login/device/code')
    expect(calls[0].body).toEqual({ client_id: CLIENT, scope: 'repo read:user' })
    expect(calls[0].headers.Accept).toBe('application/json')
  })
})

describe('pollDeviceFlow', () => {
  it('waits while pending, slows down when asked, and returns the token', async () => {
    const waits: number[] = []
    const { fn, calls } = scripted([
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 10 },
      { error: 'authorization_pending' },
      { access_token: TOKEN, token_type: 'bearer', scope: 'repo,read:user' }
    ])
    const token = await pollDeviceFlow(CLIENT, code, { fetchFn: fn, sleep: async (ms) => void waits.push(ms) })
    expect(token).toBe(TOKEN)
    expect(waits).toEqual([5000, 5000, 10000, 10000])
    expect(calls[0].url).toBe('https://github.com/login/oauth/access_token')
    expect(calls[0].body).toEqual({
      client_id: CLIENT,
      device_code: 'dev-123',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })

  it('explains a denied request or an expired code', async () => {
    const sleep = async () => {}
    await expect(
      pollDeviceFlow(CLIENT, code, { fetchFn: scripted([{ error: 'access_denied' }]).fn, sleep })
    ).rejects.toThrow(/denied/i)
    await expect(
      pollDeviceFlow(CLIENT, code, { fetchFn: scripted([{ error: 'expired_token' }]).fn, sleep })
    ).rejects.toThrow(/expired/i)
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    const { fn } = scripted([{ error: 'authorization_pending' }, { access_token: TOKEN }])
    const sleep = async () => controller.abort()
    await expect(pollDeviceFlow(CLIENT, code, { fetchFn: fn, sleep, signal: controller.signal })).rejects.toThrow(
      /cancelled/i
    )
  })

  it('keeps waiting through a network error or a server error now and then', async () => {
    const answers: (() => Awaited<ReturnType<FetchFn>>)[] = [
      () => {
        throw new Error('read ECONNRESET')
      },
      () => ({ ok: false, status: 502, json: async () => ({}) }),
      () => ({ ok: true, status: 200, json: async () => ({ error: 'authorization_pending' }) }),
      () => ({ ok: true, status: 200, json: async () => ({ access_token: TOKEN }) })
    ]
    const fn: FetchFn = async () => answers.shift()!()
    expect(await pollDeviceFlow(CLIENT, code, { fetchFn: fn, sleep: async () => {} })).toBe(TOKEN)
  })

  it('says when GitHub cannot be reached', async () => {
    const fn: FetchFn = async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com')
    }
    await expect(pollDeviceFlow(CLIENT, code, { fetchFn: fn, sleep: async () => {} })).rejects.toThrow(
      /Could not reach GitHub/
    )
  })
})
