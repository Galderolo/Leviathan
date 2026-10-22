import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { GITHUB_CLIENT_ID, GITHUB_SCOPES, credentialArgs, noreplyEmail, withoutAccount } from '../../shared/providers'
import { pickProject } from '../../shared/forge'
import { parseRemotes } from '../../shared/parsers'
import type { Account, NewPullRequest, Provider, PullRequest, RemoteRepo } from '../../shared/types'
import { setAccountSource } from '../askpass'
import { git, setRepoGitArgs } from '../git/runner'
import { loadSettings, saveSettings } from '../settings'
import {
  closePullRequest,
  createPullRequest,
  defaultBranch,
  fetchIdentity,
  getPullRequest,
  listPullRequests,
  listRepos
} from './providers'
import { AccountStore, type Cipher } from './store'
import { pollDeviceFlow, startDeviceFlow, type DeviceCode } from './oauth'

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
  // A token is one word; spaces or line breaks inside mean something else was pasted with it.
  if (/[\s\x00-\x1f\x7f]/.test(token))
    throw new Error('The token has spaces or line breaks inside: paste only the token')
  let identity: { username: string; name: string; email: string }
  if (input.provider === 'other') {
    const username = input.username?.trim()
    if (!username) throw new Error('Enter the username for this account')
    identity = { username, name: username, email: noreplyEmail('other', host, 0, username) }
  } else {
    identity = await fetchIdentity(input.provider, host, token)
  }
  // The same account again (signed in once more, or a new token): keep it, with the new token.
  const existing = accounts()
    .list()
    .find((a) => a.provider === input.provider && a.host === host && a.username === identity.username)
  if (existing) return accounts().setToken(existing.id, token)
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

/** The hosted project of a repository and the account (with its token) to reach it. */
async function repoProject(repo: string) {
  const { stdout } = await git(['remote', '-v'], { cwd: repo })
  const project = pickProject(parseRemotes(stdout), accounts().list(), getRepoAccount(repo))
  const token = project && accounts().token(project.account.id)
  return project && token ? { ...project, token } : null
}

export async function getPullRequests(
  repo: string
): Promise<{ provider: Provider; remote: string; items: PullRequest[] } | null> {
  const project = await repoProject(repo)
  if (!project) return null
  const { provider, host } = project.account
  return {
    provider,
    remote: project.remote,
    items: await listPullRequests(provider, host, project.path, project.token)
  }
}

export async function createRepoPullRequest(repo: string, input: NewPullRequest): Promise<PullRequest> {
  const valid =
    typeof input?.title === 'string' &&
    input.title.trim() !== '' &&
    typeof input.body === 'string' &&
    typeof input.source === 'string' &&
    typeof input.target === 'string' &&
    typeof input.draft === 'boolean'
  if (!valid) throw new Error('Invalid pull request')
  const project = await repoProject(repo)
  if (!project) throw new Error("No account can reach this repository's remote")
  const { provider, host } = project.account
  return createPullRequest(provider, host, project.path, project.token, { ...input, title: input.title.trim() })
}

/**
 * Closes a pull request, after checking that the project resolved now still has
 * it at `url`: the list may come from another remote or account than today's.
 */
export async function closeRepoPullRequest(repo: string, number: number, url: string): Promise<void> {
  const project = await repoProject(repo)
  if (!project) throw new Error("No account can reach this repository's remote")
  const { provider, host } = project.account
  const current = await getPullRequest(provider, host, project.path, project.token, number)
  if (typeof url !== 'string' || current.url !== url) {
    throw new Error('This pull request is not the one the list showed any more. Refresh the list and try again.')
  }
  await closePullRequest(provider, host, project.path, project.token, number)
}

export async function getDefaultBranch(repo: string): Promise<string | null> {
  const project = await repoProject(repo)
  if (!project) return null
  return defaultBranch(project.account.provider, project.account.host, project.path, project.token)
}

/** git `-c` arguments to clone with an account's credentials. */
export function cloneArgsFor(accountId: string): string[] {
  return credentialArgs(requireAccount(accountId))
}

// ---------------------------------------------------------------------------
// Signing in to GitHub from the browser (device flow). The code being waited
// for stays here, and the token goes straight into the account store.

/** The sign-in in progress; `code` is null while GitHub has not answered yet. */
let login: { code: DeviceCode | null; controller: AbortController } | null = null

/** Starts a sign-in (cancelling one still waiting): the code for the user to enter on GitHub. */
export async function startGitHubLogin(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }> {
  cancelGitHubLogin()
  // Registered before asking GitHub, so a cancel while the code is on its way stops it too.
  const pending: { code: DeviceCode | null; controller: AbortController } = {
    code: null,
    controller: new AbortController()
  }
  login = pending
  const code = await startDeviceFlow(GITHUB_CLIENT_ID, GITHUB_SCOPES)
  if (login !== pending) throw new Error('Sign-in cancelled')
  pending.code = code
  return { userCode: code.userCode, verificationUri: code.verificationUri, expiresIn: code.expiresIn }
}

/** Waits until the code is authorized in the browser, then adds the account. */
export async function finishGitHubLogin(): Promise<Account> {
  const current = login
  if (!current?.code) throw new Error('No sign-in in progress')
  try {
    const token = await pollDeviceFlow(GITHUB_CLIENT_ID, current.code, { signal: current.controller.signal })
    return await addAccount({ provider: 'github', host: 'github.com', token })
  } finally {
    if (login === current) login = null
  }
}

export function cancelGitHubLogin(): void {
  login?.controller.abort()
  login = null
}
