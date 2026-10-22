import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Account } from '../../shared/types'

/** Encrypts tokens at rest (Electron's safeStorage in the app). */
export interface Cipher {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

interface StoredAccount extends Account {
  /** base64 of the encrypted token */
  token: string
}

/** Accounts persisted in a JSON file; tokens are only ever written encrypted. */
export class AccountStore {
  private accounts: StoredAccount[]

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher
  ) {
    try {
      this.accounts = (JSON.parse(readFileSync(file, 'utf8')) as { accounts: StoredAccount[] }).accounts ?? []
    } catch {
      this.accounts = []
    }
  }

  list(): Account[] {
    return this.accounts.map(publicPart)
  }

  get(id: string): Account | undefined {
    const found = this.accounts.find((a) => a.id === id)
    return found && publicPart(found)
  }

  /** null when the account is unknown or its token can no longer be decrypted (e.g. a restored profile). */
  token(id: string): string | null {
    const found = this.accounts.find((a) => a.id === id)
    if (!found) return null
    try {
      return this.cipher.decrypt(Buffer.from(found.token, 'base64'))
    } catch {
      return null
    }
  }

  add(account: Omit<Account, 'id'>, token: string): Account {
    if (!this.cipher.available()) throw new Error('Secure storage is not available on this system')
    const stored: StoredAccount = {
      ...account,
      id: randomUUID(),
      token: this.cipher.encrypt(token).toString('base64')
    }
    this.accounts.push(stored)
    this.save()
    return publicPart(stored)
  }

  /** Replaces the token of an account (signed in again, or a new token for it). */
  setToken(id: string, token: string): Account {
    if (!this.cipher.available()) throw new Error('Secure storage is not available on this system')
    const found = this.accounts.find((a) => a.id === id)
    if (!found) throw new Error('Account not found')
    found.token = this.cipher.encrypt(token).toString('base64')
    this.save()
    return publicPart(found)
  }

  update(id: string, patch: Partial<Pick<Account, 'name' | 'email'>>): Account {
    const found = this.accounts.find((a) => a.id === id)
    if (!found) throw new Error('Account not found')
    if (patch.name !== undefined) found.name = patch.name
    if (patch.email !== undefined) found.email = patch.email
    this.save()
    return publicPart(found)
  }

  remove(id: string): void {
    this.accounts = this.accounts.filter((a) => a.id !== id)
    this.save()
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ accounts: this.accounts }, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}

function publicPart(account: StoredAccount): Account {
  const { id, provider, host, username, name, email } = account
  return { id, provider, host, username, name, email }
}
