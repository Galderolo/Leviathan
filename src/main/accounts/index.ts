import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  GITHUB_CLIENT_ID,
  GITHUB_SCOPES,
  GITLAB_CLIENT_ID,
  GITLAB_REDIRECT_PORT,
  credentialArgs,
  noreplyEmail,
  withoutAccount
} from '../../shared/providers'
import { defaultIdentityAccount, pickProject } from '../../shared/forge'
import { commitIdentity, rememberIdentity, type CommitIdentity, type Identity } from '../../shared/identity'
import { parseRemotes } from '../../shared/parsers'
import type {
  Account,
  FileChange,
  MergeMethod,
  NewPullRequest,
  Provider,
  PullRequest,
  PullRequestComment,
  RemoteRepo
} from '../../shared/types'
import { mergeMethods } from '../../shared/providers'
import { fetchPullRequestRange, getRangeFiles } from '../git/repository'
import { setAccountSource } from '../askpass'
import { readIdentity, writeIdentity } from '../git/identity'
import { SshHosts } from '../git/sshHosts'
import { git, setRepoGitArgs } from '../git/runner'
import { loadSettings, saveSettings } from '../settings'
import {
  addPullRequestComment,
  allowedMergeMethods,
  approvePullRequest,
  canPush,
  closePullRequest,
  authorAvatar,
  createPullRequest,
  defaultBranch,
  fetchIdentity,
  getPullRequest,
  listPullRequestComments,
  listPullRequests,
  listRepos,
  mergePullRequest
} from './providers'
import { AccountStore, type Cipher, type Renewal } from './store'
import { TokenSource } from './tokens'
import { authorizeUrl, codeChallenge, exchangeCode, newSignIn, refreshTokens, waitForRedirect } from './gitlabOAuth'
import { pollDeviceFlow, startDeviceFlow, type DeviceCode } from './oauth'

const cipher: Cipher = {
  // On Linux without a keyring Electron falls back to "basic_text", which only obfuscates: treat as unavailable.
  available: async () =>
    (await safeStorage.isAsyncEncryptionAvailable()) &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'),
  encrypt: (text) => safeStorage.encryptStringAsync(text),
  decrypt: async (data) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data)
    return { text: result, reseal: shouldReEncrypt }
  }
}

let store: AccountStore | null = null

function accounts(): AccountStore {
  store ??= new AccountStore(join(app.getPath('userData'), 'accounts.json'), cipher)
  return store
}

// Only GitLab sign-ins have tokens that expire.
let tokens: TokenSource | null = null

/** An account's token, renewed first when it is about to expire. */
function freshToken(id: string): Promise<string | null> {
  tokens ??= new TokenSource(accounts(), (account, refreshToken) =>
    refreshTokens({ host: account.host, clientId: GITLAB_CLIENT_ID, refreshToken })
  )
  return tokens.token(id)
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
      .map((account) => ({ account, token: () => freshToken(account.id) }))
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
  /** For a token that expires (GitLab sign-in). */
  renewal?: Renewal
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
    if (input.provider === 'bitbucket' && host !== 'bitbucket.org') {
      throw new Error(
        'Only Bitbucket Cloud (bitbucket.org) is supported: add a Bitbucket Data Center server as "Other"'
      )
    }
    identity = await fetchIdentity(input.provider, host, token)
    // Bitbucket: the username git shows in remote URLs, when the user knows it better than the API.
    if (input.provider === 'bitbucket' && input.username?.trim()) identity.username = input.username.trim()
    if (!identity.username) {
      throw new Error('Type your Bitbucket username (the one in your remote URLs): Bitbucket did not give it')
    }
  }
  // Bitbucket has no no-reply address: without the email from the API, the user gives one.
  if (!input.email?.trim() && !identity.email) {
    throw new Error('Enter the commit email: this token cannot read the email addresses of the account')
  }
  // The same account again (signed in once more, or a new token): keep it, with the new token.
  const existing = accounts()
    .list()
    .find((a) => a.provider === input.provider && a.host === host && a.username === identity.username)
  if (existing) return accounts().setToken(existing.id, token, input.renewal)
  return accounts().add(
    {
      provider: input.provider,
      host,
      username: identity.username,
      name: input.name?.trim() || identity.name,
      email: input.email?.trim() || identity.email
    },
    token,
    input.renewal
  )
}

async function applyIdentity(repo: string, account: Account): Promise<void> {
  await writeIdentity(repo, { name: account.name, email: account.email })
}

function boundRepos(accountId: string): string[] {
  return Object.entries(loadSettings().repoAccounts ?? {})
    .filter(([, id]) => id === accountId)
    .map(([repo]) => repo)
}

export async function updateAccount(id: string, patch: { name?: string; email?: string }): Promise<Account> {
  const before = requireAccount(id)
  const account = accounts().update(id, patch)
  for (const repo of boundRepos(id)) {
    // Only where the repository still has the account's identity: one given another keeps it.
    const { local } = await readIdentity(repo).catch(() => ({ local: null }))
    if (local?.name === before.name && local.email === before.email) await applyIdentity(repo, account).catch(() => {})
  }
  return account
}

/** The picture the repository's server has for one of its authors, asked through the account that reaches it. */
export function authorAvatarFor(repo: string): (author: { hash?: string; email: string }) => Promise<string | null> {
  let project: ReturnType<typeof repoProject> | null = null
  return async (author) => {
    project ??= repoProject(repo).catch(() => null)
    const found = await project
    if (!found) return null
    return authorAvatar(found.account.provider, found.account.host, found.path, author, found.token)
  }
}

/** Who the next commit of a repository will be by, and where that comes from. */
export async function getCommitIdentity(repo: string): Promise<CommitIdentity> {
  const { local, effective } = await readIdentity(repo)
  const id = getRepoAccount(repo)
  return commitIdentity(local, effective, (id && accounts().get(id)) || null)
}

/** Repositories no account owns or may push to, this session: the servers are not asked on every opening. */
const withoutDefaultIdentity = new Set<string>()

/**
 * Gives a repository that has no identity of its own (and no account) the one of the account that owns its project,
 * or else of one that may push to it. A repository with an identity of its own is never touched.
 */
export async function ensureDefaultIdentity(repo: string): Promise<void> {
  if (getRepoAccount(repo) || withoutDefaultIdentity.has(repo)) return
  const { local } = await readIdentity(repo)
  if (local.name || local.email) return
  const account = await defaultIdentityAccount(await repoRemotes(repo), accounts().list(), async (a, path) => {
    const token = await freshToken(a.id).catch(() => null)
    return !!token && canPush(a.provider, a.host, path, token)
  })
  if (account) await setRepoAccount(repo, account.id)
  else withoutDefaultIdentity.add(repo)
}

/**
 * The identity of a repository's next commits: an account's (bound to it, as when picked in Settings), one typed
 * (remembered to pick again), or the global one (the repository's own is taken away).
 */
export async function setCommitIdentity(
  repo: string,
  choice: { account: string } | Identity | 'global'
): Promise<void> {
  if (choice === 'global') return writeIdentity(repo, null)
  if ('account' in choice) return setRepoAccount(repo, choice.account)
  const identity = { name: choice.name.trim(), email: choice.email.trim() }
  if (!identity.name || !identity.email) throw new Error('A commit identity needs a name and an email.')
  await writeIdentity(repo, identity)
  saveSettings({ recentIdentities: rememberIdentity(loadSettings().recentIdentities ?? [], identity) })
}

export function removeAccount(id: string): void {
  for (const repo of boundRepos(id)) setRepoGitArgs(repo, null)
  saveSettings({ repoAccounts: withoutAccount(loadSettings().repoAccounts ?? {}, id) })
  accounts().remove(id)
}

export async function listAccountRepos(id: string): Promise<RemoteRepo[]> {
  const account = requireAccount(id)
  if (account.provider === 'other') return []
  return listRepos(account.provider, account.host, (await freshToken(id)) ?? '')
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

const sshHosts = new SshHosts()

/** A repository's remotes, with the real host behind an SSH alias in their URLs (to find the account for them). */
async function repoRemotes(repo: string) {
  const { stdout } = await git(['remote', '-v'], { cwd: repo })
  return sshHosts.resolve(parseRemotes(stdout))
}

/** The hosted project of a repository and the account (with its token) to reach it. */
async function repoProject(repo: string) {
  const project = pickProject(await repoRemotes(repo), accounts().list(), getRepoAccount(repo))
  const token = project && (await freshToken(project.account.id))
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

// ---------------------------------------------------------------------------
// Signing in to GitLab.com from the browser: GitLab sends the browser back to a
// local address with a code, which is traded for tokens (with PKCE: no secret).

let gitlabLogin: { controller: AbortController; code: Promise<string>; verifier: string } | null = null

/** Starts a sign-in (cancelling one still waiting): the page to open in the browser. */
export async function startGitLabLogin(): Promise<{ url: string }> {
  cancelGitLabLogin()
  const { verifier, state } = newSignIn()
  const controller = new AbortController()
  let listening!: () => void
  const ready = new Promise<void>((resolve) => (listening = resolve))
  const code = waitForRedirect(GITLAB_REDIRECT_PORT, state, controller.signal, listening)
  code.catch(() => {})
  gitlabLogin = { controller, code, verifier }
  // A busy port fails here, before the browser is sent anywhere.
  await Promise.race([ready, code])
  const url = authorizeUrl({
    host: 'gitlab.com',
    clientId: GITLAB_CLIENT_ID,
    port: GITLAB_REDIRECT_PORT,
    state,
    challenge: codeChallenge(verifier)
  })
  return { url }
}

/** Waits until the browser comes back from GitLab, then adds the account. */
export async function finishGitLabLogin(): Promise<Account> {
  const current = gitlabLogin
  if (!current) throw new Error('No sign-in in progress')
  try {
    const code = await current.code
    const signedIn = await exchangeCode({
      host: 'gitlab.com',
      clientId: GITLAB_CLIENT_ID,
      port: GITLAB_REDIRECT_PORT,
      code,
      verifier: current.verifier
    })
    if (current.controller.signal.aborted) throw new Error('Sign-in cancelled')
    return await addAccount({
      provider: 'gitlab',
      host: 'gitlab.com',
      token: signedIn.accessToken,
      renewal: { refreshToken: signedIn.refreshToken, expiresAt: signedIn.expiresAt }
    })
  } finally {
    if (gitlabLogin === current) gitlabLogin = null
  }
}

export function cancelGitLabLogin(): void {
  gitlabLogin?.controller.abort()
  gitlabLogin = null
}

// ---------------------------------------------------------------------------
// Reviewing a pull request of a repository's hosted project.

async function requireProject(repo: string) {
  const project = await repoProject(repo)
  if (!project) throw new Error("No account can reach this repository's remote")
  return project
}

/** A pull request's commits fetched for review (nothing checked out): its range and the files it changes. */
export async function reviewPullRequest(
  repo: string,
  pr: { number: number; sourceBranch: string; targetBranch: string; fromFork: boolean }
): Promise<{ base: string; head: string; files: FileChange[] }> {
  const project = await requireProject(repo)
  const range = await fetchPullRequestRange(repo, project.remote, pr, project.account.provider)
  return { ...range, files: await getRangeFiles(repo, range.base, range.head) }
}

export async function getPullRequestComments(repo: string, number: number): Promise<PullRequestComment[]> {
  const { account, path, token } = await requireProject(repo)
  return listPullRequestComments(account.provider, account.host, path, token, number)
}

export async function commentOnPullRequest(repo: string, number: number, body: string): Promise<PullRequestComment> {
  if (typeof body !== 'string' || !body.trim()) throw new Error('The comment is empty')
  const { account, path, token } = await requireProject(repo)
  return addPullRequestComment(account.provider, account.host, path, token, number, body.trim())
}

/** Checks the project resolved now still has the pull request the review showed (a rebinding may change it). */
async function reviewedProject(repo: string, number: number, url: string) {
  const project = await requireProject(repo)
  const { account, path, token } = project
  const current = await getPullRequest(account.provider, account.host, path, token, number)
  if (typeof url !== 'string' || current.url !== url) {
    throw new Error('This pull request is not the one the review showed any more. Open it again.')
  }
  return project
}

/** Approves the pull request at `head`, the commit the review showed. */
export async function approveRepoPullRequest(repo: string, number: number, url: string, head: string): Promise<void> {
  const { account, path, token } = await reviewedProject(repo, number, url)
  await approvePullRequest(account.provider, account.host, path, token, number, head)
}

/** The ways the project lets a pull request into `targetBranch` merge, its default first. */
export async function getMergeMethods(repo: string, targetBranch: string): Promise<MergeMethod[]> {
  if (typeof targetBranch !== 'string' || !targetBranch) throw new Error('Invalid branch')
  const { account, path, token } = await requireProject(repo)
  return allowedMergeMethods(account.provider, account.host, path, token, targetBranch)
}

/** Merges a pull request at the reviewed commit, after checking it is still the one the review showed. */
export async function mergeRepoPullRequest(
  repo: string,
  number: number,
  url: string,
  method: MergeMethod,
  head: string
): Promise<void> {
  const { account } = await requireProject(repo)
  if (!mergeMethods(account.provider).includes(method)) throw new Error(`This provider cannot merge with ${method}`)
  const { path, token } = await reviewedProject(repo, number, url)
  await mergePullRequest(account.provider, account.host, path, token, number, method, head)
}
