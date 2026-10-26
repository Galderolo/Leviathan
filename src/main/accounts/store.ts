import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Account } from '../../shared/types'

/** Encrypts tokens at rest (Electron's safeStorage in the app). */
export interface Cipher {
  available(): Promise<boolean>
  encrypt(text: string): Promise<Buffer>
  /** `reseal`: the key changed since, the text should be encrypted again. */
  decrypt(data: Buffer): Promise<{ text: string; reseal: boolean }>
}

/** What renews an access token that expires (GitLab sign-in). */
export interface Renewal {
  refreshToken: string
  /** When the access token expires, unix milliseconds. */
  expiresAt: number
}

interface StoredAccount extends Account {
  /** base64 of the encrypted token */
  token: string
  /** base64 of the encrypted renewal token, for tokens that expire. */
  refresh?: string
  expiresAt?: number
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
  async token(id: string): Promise<string | null> {
    const found = this.accounts.find((a) => a.id === id)
    if (!found) return null
    return this.open(found, 'token')
  }

  /** Null for tokens that do not expire, or when the renewal token cannot be decrypted. */
  async renewal(id: string): Promise<Renewal | null> {
    const found = this.accounts.find((a) => a.id === id)
    if (!found?.refresh || found.expiresAt === undefined) return null
    const refreshToken = await this.open(found, 'refresh')
    return refreshToken === null ? null : { refreshToken, expiresAt: found.expiresAt }
  }

  async add(account: Omit<Account, 'id'>, token: string, renewal?: Renewal): Promise<Account> {
    await this.assertAvailable()
    const stored: StoredAccount = {
      ...account,
      id: randomUUID(),
      token: await this.seal(token),
      ...(await this.sealed(renewal))
    }
    this.accounts.push(stored)
    this.save()
    return publicPart(stored)
  }

  /** Replaces the token of an account (signed in again, renewed, or a new token for it). */
  async setToken(id: string, token: string, renewal?: Renewal): Promise<Account> {
    await this.assertAvailable()
    const found = this.accounts.find((a) => a.id === id)
    if (!found) throw new Error('Account not found')
    found.token = await this.seal(token)
    const sealed = await this.sealed(renewal)
    found.refresh = sealed.refresh
    found.expiresAt = sealed.expiresAt
    this.save()
    return publicPart(found)
  }

  private async assertAvailable(): Promise<void> {
    if (!(await this.cipher.available())) throw new Error('Secure storage is not available on this system')
  }

  private async seal(text: string): Promise<string> {
    return (await this.cipher.encrypt(text)).toString('base64')
  }

  /** A stored secret in clear; encrypted again, and saved, when the key changed since. Null when unreadable. */
  private async open(found: StoredAccount, field: 'token' | 'refresh'): Promise<string | null> {
    try {
      const { text, reseal } = await this.cipher.decrypt(Buffer.from(found[field]!, 'base64'))
      if (reseal) {
        found[field] = await this.seal(text)
        this.save()
      }
      return text
    } catch {
      return null
    }
  }

  private async sealed(renewal?: Renewal): Promise<Pick<StoredAccount, 'refresh' | 'expiresAt'>> {
    if (!renewal) return { refresh: undefined, expiresAt: undefined }
    return { refresh: await this.seal(renewal.refreshToken), expiresAt: renewal.expiresAt }
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
