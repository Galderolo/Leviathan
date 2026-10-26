import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountStore, type Cipher } from '../src/main/accounts/store'

const reverse = (text: string) => [...text].reverse().join('')

/** Reversible stand-in for safeStorage: reverses the text, so plaintext never appears on disk. */
const fakeCipher: Cipher = {
  available: async () => true,
  encrypt: async (text) => Buffer.from(reverse(text), 'utf8'),
  decrypt: async (data) => ({ text: reverse(data.toString('utf8')), reseal: false })
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
  it('stores accounts with encrypted tokens', async () => {
    const store = new AccountStore(file, fakeCipher)
    const account = await store.add(input, TOKEN)
    expect(account).toMatchObject(input)
    expect(account.id).toMatch(/\w{8}-/)
    expect(store.list()).toEqual([account])
    expect(await store.token(account.id)).toBe(TOKEN)
    expect(JSON.stringify(store.list())).not.toContain(TOKEN)
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN)
  })

  it('reloads accounts and tokens from disk', async () => {
    const account = await new AccountStore(file, fakeCipher).add(input, TOKEN)
    const again = new AccountStore(file, fakeCipher)
    expect(again.get(account.id)).toEqual(account)
    expect(await again.token(account.id)).toBe(TOKEN)
  })

  it('updates the commit identity and removes accounts', async () => {
    const store = new AccountStore(file, fakeCipher)
    const account = await store.add(input, TOKEN)
    expect(store.update(account.id, { name: 'Ana B', email: 'a@b.c' })).toMatchObject({ name: 'Ana B', email: 'a@b.c' })
    store.remove(account.id)
    expect(store.list()).toEqual([])
    expect(await store.token(account.id)).toBeNull()
  })

  it('treats a token that can no longer be decrypted as missing', async () => {
    const account = await new AccountStore(file, fakeCipher).add(input, TOKEN)
    const broken = new AccountStore(file, {
      ...fakeCipher,
      decrypt: async () => {
        throw new Error('keyring changed')
      }
    })
    expect(await broken.token(account.id)).toBeNull()
    expect(broken.list()).toHaveLength(1)
  })

  it('encrypts a token again when secure storage says its key changed', async () => {
    const account = await new AccountStore(file, fakeCipher).add(input, TOKEN)
    const before = readFileSync(file, 'utf8')
    // The new key: what it encrypts starts with "v2:"; what the old one did must be encrypted again.
    const rotated: Cipher = {
      available: async () => true,
      encrypt: async (text) => Buffer.from(`v2:${reverse(text)}`, 'utf8'),
      decrypt: async (data) => {
        const raw = data.toString('utf8')
        return raw.startsWith('v2:')
          ? { text: reverse(raw.slice(3)), reseal: false }
          : { text: reverse(raw), reseal: true }
      }
    }
    const store = new AccountStore(file, rotated)
    expect(await store.token(account.id)).toBe(TOKEN)
    const after = readFileSync(file, 'utf8')
    expect(after).not.toBe(before)
    expect(after).not.toContain(TOKEN)
    expect(await new AccountStore(file, rotated).token(account.id)).toBe(TOKEN)
  })

  it('refuses to store tokens without secure storage', async () => {
    const store = new AccountStore(file, { ...fakeCipher, available: async () => false })
    await expect(store.add(input, TOKEN)).rejects.toThrow(/Secure storage is not available/)
  })
})
