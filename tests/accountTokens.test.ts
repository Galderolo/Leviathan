import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountStore, type Cipher } from '../src/main/accounts/store'
import { TokenSource } from '../src/main/accounts/tokens'

const reverse = (text: string) => [...text].reverse().join('')
const fakeCipher: Cipher = {
  available: async () => true,
  encrypt: async (text) => Buffer.from(reverse(text), 'utf8'),
  decrypt: async (data) => ({ text: reverse(data.toString('utf8')), reseal: false })
}

const gitlab = { provider: 'gitlab' as const, host: 'gitlab.com', username: 'bo', name: 'Bo', email: 'bo@x.invalid' }
const HOUR = 3600_000

let dir: string
let store: AccountStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leviathan-tokens-'))
  store = new AccountStore(join(dir, 'accounts.json'), fakeCipher)
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('renewable tokens (GitLab sign-in)', () => {
  it('keeps the renewal token encrypted next to the access token', async () => {
    const account = await store.add(gitlab, 'A1', { refreshToken: 'R1-secret', expiresAt: 5 * HOUR })
    expect(await store.renewal(account.id)).toEqual({ refreshToken: 'R1-secret', expiresAt: 5 * HOUR })
    expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).not.toContain('R1-secret')
    // A personal access token pasted later replaces the sign-in: nothing to renew any more.
    await store.setToken(account.id, 'glpat-x')
    expect(await store.renewal(account.id)).toBeNull()
  })

  it('renews a token about to expire, once for everyone asking at the same time, and keeps the new pair', async () => {
    const account = await store.add(gitlab, 'A1', { refreshToken: 'R1', expiresAt: 1 * HOUR })
    let now = 0
    const renewals: string[] = []
    const tokens = new TokenSource(
      store,
      async (_account, refreshToken) => {
        renewals.push(refreshToken)
        await new Promise((r) => setTimeout(r, 20))
        return { accessToken: 'A2', refreshToken: 'R2', expiresAt: now + 2 * HOUR }
      },
      () => now
    )
    expect(await tokens.token(account.id)).toBe('A1')
    expect(renewals).toEqual([])

    now = 1 * HOUR - 60_000 // a minute left
    expect(await Promise.all([tokens.token(account.id), tokens.token(account.id)])).toEqual(['A2', 'A2'])
    expect(renewals).toEqual(['R1'])
    expect(await store.token(account.id)).toBe('A2')
    expect(await store.renewal(account.id)).toEqual({ refreshToken: 'R2', expiresAt: now + 2 * HOUR })
  })

  it('leaves tokens that do not expire alone, and passes on why a renewal failed', async () => {
    const plain = await store.add({ ...gitlab, username: 'cy' }, 'glpat-1')
    const signedIn = await store.add(gitlab, 'A1', { refreshToken: 'R1', expiresAt: 0 })
    const tokens = new TokenSource(
      store,
      async () => {
        throw new Error('The GitLab sign-in expired: sign in again')
      },
      () => HOUR
    )
    expect(await tokens.token(plain.id)).toBe('glpat-1')
    await expect(tokens.token(signedIn.id)).rejects.toThrow('sign in again')
    expect(await tokens.token('unknown')).toBeNull()
  })
})
