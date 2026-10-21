import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountStore, type Cipher } from '../src/main/accounts/store'

/** Reversible stand-in for safeStorage: reverses the text, so plaintext never appears on disk. */
const fakeCipher: Cipher = {
  available: () => true,
  encrypt: (text) => Buffer.from([...text].reverse().join(''), 'utf8'),
  decrypt: (data) => [...data.toString('utf8')].reverse().join('')
}

const TOKEN = 'ghp_SuperSecretToken123'
const input = {
  provider: 'github' as const,
  host: 'github.com',
  username: 'ana',
  name: 'Ana',
  email: '1+ana@users.noreply.github.com'
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leviathan-accounts-'))
  file = join(dir, 'accounts.json')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('AccountStore', () => {
  it('stores accounts with encrypted tokens', () => {
    const store = new AccountStore(file, fakeCipher)
    const account = store.add(input, TOKEN)
    expect(account).toMatchObject(input)
    expect(account.id).toMatch(/\w{8}-/)
    expect(store.list()).toEqual([account])
    expect(store.token(account.id)).toBe(TOKEN)
    expect(JSON.stringify(store.list())).not.toContain(TOKEN)
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN)
  })

  it('reloads accounts and tokens from disk', () => {
    const account = new AccountStore(file, fakeCipher).add(input, TOKEN)
    const again = new AccountStore(file, fakeCipher)
    expect(again.get(account.id)).toEqual(account)
    expect(again.token(account.id)).toBe(TOKEN)
  })

  it('updates the commit identity and removes accounts', () => {
    const store = new AccountStore(file, fakeCipher)
    const account = store.add(input, TOKEN)
    expect(store.update(account.id, { name: 'Ana B', email: 'a@b.c' })).toMatchObject({ name: 'Ana B', email: 'a@b.c' })
    store.remove(account.id)
    expect(store.list()).toEqual([])
    expect(store.token(account.id)).toBeNull()
  })

  it('treats a token that can no longer be decrypted as missing', () => {
    const account = new AccountStore(file, fakeCipher).add(input, TOKEN)
    const broken = new AccountStore(file, {
      ...fakeCipher,
      decrypt: () => {
        throw new Error('keyring changed')
      }
    })
    expect(broken.token(account.id)).toBeNull()
    expect(broken.list()).toHaveLength(1)
  })

  it('refuses to store tokens without secure storage', () => {
    const store = new AccountStore(file, { ...fakeCipher, available: () => false })
    expect(() => store.add(input, TOKEN)).toThrow(/Secure storage is not available/)
  })
})
