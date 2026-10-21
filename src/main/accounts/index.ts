import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { credentialArgs, noreplyEmail, withoutAccount } from '../../shared/providers'
import type { Account, Provider, RemoteRepo } from '../../shared/types'
import { setAccountSource } from '../askpass'
import { git, setRepoGitArgs } from '../git/runner'
import { loadSettings, saveSettings } from '../settings'
import { fetchIdentity, listRepos } from './providers'
import { AccountStore, type Cipher } from './store'

const cipher: Cipher = {
  // On Linux without a keyring Electron falls back to "basic_text", which only obfuscates: treat as unavailable.
  available: () =>
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data)
}

let store: AccountStore | null = null

function accounts(): AccountStore {
  store ??= new AccountStore(join(app.getPath('userData'), 'accounts.json'), cipher)
  return store
}

function requireAccount(id: string): Account {
  const account = accounts().get(id)
  if (!account) throw new Error('Account not found')
  return account
}

/** Loads bindings into the git runner and lets askpass answer from stored tokens. */
export function initAccounts(): void {
  setAccountSource(() =>
    accounts()
      .list()
      .map((account) => ({ account, token: accounts().token(account.id) ?? '' }))
      .filter((c) => c.token)
  )
  for (const [repo, id] of Object.entries(loadSettings().repoAccounts ?? {})) {
    const account = accounts().get(id)
    if (account) setRepoGitArgs(repo, credentialArgs(account))
  }
}

export function listAccounts(): Account[] {
  return accounts().list()
}

function normaliseHost(host: string): string {
  const clean = host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(clean)) throw new Error(`Invalid host: ${host}`)
  return clean
}

export async function addAccount(input: {
  provider: Provider
  host: string
  token: string
  username?: string
  name?: string
  email?: string
}): Promise<Account> {
  const host = normaliseHost(input.host)
  const token = input.token.trim()
  if (!token) throw new Error('The token is empty')
  let identity: { username: string; name: string; email: string }
  if (input.provider === 'other') {
    const username = input.username?.trim()
    if (!username) throw new Error('Enter the username for this account')
    identity = { username, name: username, email: noreplyEmail('other', host, 0, username) }
  } else {
    identity = await fetchIdentity(input.provider, host, token)
  }
  return accounts().add(
    {
      provider: input.provider,
      host,
      username: identity.username,
      name: input.name?.trim() || identity.name,
      email: input.email?.trim() || identity.email
    },
    token
  )
}

async function applyIdentity(repo: string, account: Account): Promise<void> {
  await git(['config', 'user.name', account.name], { cwd: repo })
  await git(['config', 'user.email', account.email], { cwd: repo })
}

function boundRepos(accountId: string): string[] {
  return Object.entries(loadSettings().repoAccounts ?? {})
    .filter(([, id]) => id === accountId)
    .map(([repo]) => repo)
}

export async function updateAccount(id: string, patch: { name?: string; email?: string }): Promise<Account> {
  const account = accounts().update(id, patch)
  for (const repo of boundRepos(id)) await applyIdentity(repo, account).catch(() => {})
  return account
}

export function removeAccount(id: string): void {
  for (const repo of boundRepos(id)) setRepoGitArgs(repo, null)
  saveSettings({ repoAccounts: withoutAccount(loadSettings().repoAccounts ?? {}, id) })
  accounts().remove(id)
}

export async function listAccountRepos(id: string): Promise<RemoteRepo[]> {
  const account = requireAccount(id)
  if (account.provider === 'other') return []
  return listRepos(account.provider, account.host, accounts().token(id) ?? '')
}

export function getRepoAccount(repo: string): string | null {
  return loadSettings().repoAccounts?.[repo] ?? null
}

/**
 * Binds a repository to an account (its commit identity and HTTPS credentials),
 * or unbinds it with `null`. Unbinding leaves the repository's identity as it is.
 */
export async function setRepoAccount(repo: string, accountId: string | null): Promise<void> {
  const map = { ...(loadSettings().repoAccounts ?? {}) }
  if (accountId) {
    const account = requireAccount(accountId)
    await applyIdentity(repo, account)
    setRepoGitArgs(repo, credentialArgs(account))
    map[repo] = accountId
  } else {
    setRepoGitArgs(repo, null)
    delete map[repo]
  }
  saveSettings({ repoAccounts: map })
}

/** git `-c` arguments to clone with an account's credentials. */
export function cloneArgsFor(accountId: string): string[] {
  return credentialArgs(requireAccount(accountId))
}
