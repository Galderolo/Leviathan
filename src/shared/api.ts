import type {
  Account,
  AskpassRequest,
  BlameLine,
  Commit,
  CommitDetails,
  DiffSource,
  FileCommit,
  FileDiff,
  NewPullRequest,
  ProgressEvent,
  Provider,
  PullRequest,
  PullMode,
  RebaseCommit,
  RemoteRepo,
  RepoChangedEvent,
  RepoState,
  ResetMode,
  Settings,
  SshKey,
  WorkingFile
} from './types'
import type { RebaseItem } from './rebase'
import type { RepoChange, Snapshot } from './undo'

/**
 * Everything the renderer can ask the main process to do.
 * Every method is invoked over a single IPC channel (see `API_METHODS`).
 */
export interface LeviathanInvokeApi {
  // App / settings
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  pickFolder(title?: string): Promise<string | null>
  gitVersion(): Promise<string>
  appVersion(): Promise<string>

  // Repository lifecycle
  openRepo(path: string): Promise<string>
  initRepo(path: string, branch: string): Promise<string>
  /** With `accountId`, clones with that account and binds the new repository to it. */
  cloneRepo(url: string, dest: string, accountId?: string | null): Promise<string>
  watchRepo(repo: string): Promise<void>
  unwatchRepo(repo: string): Promise<void>

  // Reading
  getState(repo: string): Promise<RepoState>
  getLog(repo: string, limit: number): Promise<{ commits: Commit[]; hasMore: boolean }>
  getCommitDetails(repo: string, hash: string): Promise<CommitDetails>
  getDiff(repo: string, source: DiffSource): Promise<FileDiff>
  getSnapshot(repo: string): Promise<Snapshot>
  /** Commits that touched a file, newest first, following renames. */
  getFileHistory(repo: string, path: string, rev: string | null): Promise<FileCommit[]>
  /** Who last changed each line: in the working tree (`rev` null) or in a commit. */
  getBlame(repo: string, path: string, rev: string | null): Promise<BlameLine[]>

  // Conflicts
  readWorkingFile(repo: string, path: string): Promise<WorkingFile>
  /** Refused when the file no longer holds `original`, the text the resolution was made from. */
  resolveConflictFile(repo: string, path: string, content: string, original: string): Promise<void>
  resolveConflictWith(repo: string, path: string, side: 'ours' | 'theirs'): Promise<void>
  /** Applies a recorded change; refuses when the repository no longer matches its starting state. */
  applyChange(repo: string, change: RepoChange): Promise<void>

  // Interactive rebase
  getRebaseCommits(repo: string, base: string): Promise<RebaseCommit[]>
  /** Refused when the branch no longer holds exactly the commits in `items`. */
  interactiveRebase(repo: string, base: string, items: RebaseItem[]): Promise<void>

  // Working tree
  stage(repo: string, paths: string[]): Promise<void>
  stageAll(repo: string): Promise<void>
  unstage(repo: string, paths: string[]): Promise<void>
  unstageAll(repo: string): Promise<void>
  discard(repo: string, paths: string[], untracked: string[]): Promise<void>
  discardAll(repo: string): Promise<void>
  applyPatch(repo: string, patch: string, opts: { cached: boolean; reverse: boolean }): Promise<void>
  commit(repo: string, message: string, amend: boolean): Promise<void>
  headMessage(repo: string): Promise<string>
  ignore(repo: string, pattern: string): Promise<void>

  // Branches & refs
  checkout(repo: string, ref: string): Promise<void>
  checkoutRemote(repo: string, remoteBranch: string): Promise<void>
  checkoutDetached(repo: string, hash: string): Promise<void>
  createBranch(repo: string, name: string, startPoint: string | null, checkout: boolean): Promise<void>
  renameBranch(repo: string, oldName: string, newName: string): Promise<void>
  deleteBranch(repo: string, name: string, force: boolean): Promise<void>
  deleteRemoteBranch(repo: string, remote: string, branch: string): Promise<void>
  merge(repo: string, ref: string): Promise<void>
  rebase(repo: string, onto: string): Promise<void>
  cherryPick(repo: string, hash: string): Promise<void>
  revert(repo: string, hash: string): Promise<void>
  reset(repo: string, hash: string, mode: ResetMode): Promise<void>
  abortOperation(repo: string): Promise<void>
  continueOperation(repo: string): Promise<void>
  createTag(repo: string, name: string, hash: string, message: string | null): Promise<void>
  deleteTag(repo: string, name: string): Promise<void>

  // Stash
  stashSave(repo: string, message: string | null): Promise<void>
  /** `hash` must match `stash@{index}`; guards against the list changing meanwhile. */
  stashPop(repo: string, index: number, hash: string): Promise<void>
  stashApply(repo: string, index: number, hash: string): Promise<void>
  stashDrop(repo: string, index: number, hash: string): Promise<void>

  // Remotes
  /** `background` fetches never prompt for credentials. */
  fetch(repo: string, background?: boolean): Promise<void>
  pull(repo: string, mode: PullMode): Promise<void>
  /** Fast-forwards a branch that is not checked out to its upstream. */
  pullBranch(repo: string, branch: string): Promise<void>
  push(repo: string, opts: { force: boolean; branch?: string; remote?: string }): Promise<void>
  pushTag(repo: string, remote: string, tag: string): Promise<void>
  addRemote(repo: string, name: string, url: string): Promise<void>
  removeRemote(repo: string, name: string): Promise<void>

  // Shell integration
  openTerminal(repo: string): Promise<void>
  /** Opens a folder in the file manager. */
  openPath(path: string): Promise<void>
  /**
   * Opens a repository file with its default app, or only reveals it in its
   * folder when opening would execute it (scripts, executables, shortcuts).
   */
  openRepoFile(repo: string, file: string): Promise<'opened' | 'revealed'>
  showInFolder(path: string): Promise<void>
  openExternal(url: string): Promise<void>

  // Authentication
  /** Answers a prompt received through `onAskpass`; null cancels it. */
  answerAskpass(id: string, value: string | null): Promise<void>
  listSshKeys(): Promise<SshKey[]>

  // Accounts (tokens never leave the main process)
  listAccounts(): Promise<Account[]>
  addAccount(input: {
    provider: Provider
    host: string
    token: string
    username?: string
    name?: string
    email?: string
  }): Promise<Account>
  updateAccount(id: string, patch: { name?: string; email?: string }): Promise<Account>
  removeAccount(id: string): Promise<void>
  listAccountRepos(id: string): Promise<RemoteRepo[]>
  getRepoAccount(repo: string): Promise<string | null>
  setRepoAccount(repo: string, accountId: string | null): Promise<void>
  /** Sign in to GitHub from the browser: the code to enter there, then the account once authorized. */
  startGitHubLogin(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }>
  finishGitHubLogin(): Promise<Account>
  cancelGitHubLogin(): Promise<void>

  // Pull requests, through the account for the repository's remote (null: no such account)
  getPullRequests(repo: string): Promise<{ provider: Provider; remote: string; items: PullRequest[] } | null>
  createPullRequest(repo: string, input: NewPullRequest): Promise<PullRequest>
  /** Closes a pull request without merging it. */
  closePullRequest(repo: string, number: number, url: string): Promise<void>
  getDefaultBranch(repo: string): Promise<string | null>
  checkoutPullRequest(
    repo: string,
    remote: string,
    pr: { number: number; sourceBranch: string; fromFork: boolean },
    provider: Provider
  ): Promise<void>
  /** Creates an ed25519 key in ~/.ssh; refuses to overwrite. */
  generateSshKey(opts: { email: string; passphrase: string; fileName: string }): Promise<SshKey>
}

/** Event subscriptions exposed next to the invoke methods. */
export interface LeviathanEventsApi {
  onRepoChanged(cb: (e: RepoChangedEvent) => void): () => void
  onProgress(cb: (e: ProgressEvent) => void): () => void
  onAskpass(cb: (e: AskpassRequest) => void): () => void
}

export type LeviathanApi = LeviathanInvokeApi & LeviathanEventsApi

/**
 * Exhaustive list of invokable methods. Typed as a Record so the compiler
 * fails if a method is added to `LeviathanInvokeApi` but not listed here.
 */
const METHODS: Record<keyof LeviathanInvokeApi, true> = {
  getSettings: true,
  saveSettings: true,
  pickFolder: true,
  gitVersion: true,
  appVersion: true,
  openRepo: true,
  initRepo: true,
  cloneRepo: true,
  watchRepo: true,
  unwatchRepo: true,
  getState: true,
  getLog: true,
  getCommitDetails: true,
  getDiff: true,
  getSnapshot: true,
  getFileHistory: true,
  getBlame: true,
  readWorkingFile: true,
  resolveConflictFile: true,
  resolveConflictWith: true,
  applyChange: true,
  getRebaseCommits: true,
  interactiveRebase: true,
  stage: true,
  stageAll: true,
  unstage: true,
  unstageAll: true,
  discard: true,
  discardAll: true,
  applyPatch: true,
  commit: true,
  headMessage: true,
  ignore: true,
  checkout: true,
  checkoutRemote: true,
  checkoutDetached: true,
  createBranch: true,
  renameBranch: true,
  deleteBranch: true,
  deleteRemoteBranch: true,
  merge: true,
  rebase: true,
  cherryPick: true,
  revert: true,
  reset: true,
  abortOperation: true,
  continueOperation: true,
  createTag: true,
  deleteTag: true,
  stashSave: true,
  stashPop: true,
  stashApply: true,
  stashDrop: true,
  fetch: true,
  pull: true,
  pullBranch: true,
  push: true,
  pushTag: true,
  addRemote: true,
  removeRemote: true,
  openTerminal: true,
  openPath: true,
  openRepoFile: true,
  showInFolder: true,
  openExternal: true,
  answerAskpass: true,
  listSshKeys: true,
  listAccounts: true,
  addAccount: true,
  updateAccount: true,
  removeAccount: true,
  listAccountRepos: true,
  getRepoAccount: true,
  setRepoAccount: true,
  startGitHubLogin: true,
  finishGitHubLogin: true,
  cancelGitHubLogin: true,
  getPullRequests: true,
  createPullRequest: true,
  closePullRequest: true,
  getDefaultBranch: true,
  checkoutPullRequest: true,
  generateSshKey: true
}

export const API_METHODS = Object.keys(METHODS) as (keyof LeviathanInvokeApi)[]

export const IPC_INVOKE = 'leviathan:invoke'
export const IPC_REPO_CHANGED = 'leviathan:repo-changed'
export const IPC_PROGRESS = 'leviathan:progress'
export const IPC_ASKPASS = 'leviathan:askpass'

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
