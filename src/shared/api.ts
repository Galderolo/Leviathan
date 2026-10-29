import type {
  Account,
  AskpassRequest,
  BlameLine,
  Commit,
  CommitDetails,
  DiffSource,
  FileChange,
  FileCommit,
  FileDiff,
  MergeMethod,
  NewPullRequest,
  ProgressEvent,
  Provider,
  PullRequest,
  PullRequestComment,
  PullMode,
  RebaseList,
  RemoteRepo,
  RepoChangedEvent,
  RepoState,
  ResetMode,
  Settings,
  SshKey,
  Submodule,
  WorkingFile
} from './types'
import type { CheckoutBlock } from './checkout'
import type { CommitDraftText } from './commitTemplate'
import type { CommitIdentity, Identity } from './identity'
import type { LfsInfo, LfsLock, LfsPattern, LfsSetup } from './lfs'
import type { LfsInstallOffer } from './lfsInstall'
import type { RebaseItem } from './rebase'
import type { ReleaseNote } from './releaseNotes'
import type { RepoChange, Snapshot } from './undo'
import type { UpdateState } from './updates'

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
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  /** Downloads the update, or opens its release page where the app cannot replace itself. */
  downloadUpdate(): Promise<void>
  /** Quits and installs a downloaded update. */
  installUpdate(): Promise<void>
  /** Notes of every published release, newest first; throws when GitHub cannot be reached. */
  getReleaseNotes(): Promise<ReleaseNote[]>

  // Repository lifecycle
  openRepo(path: string): Promise<string>
  initRepo(path: string, branch: string): Promise<string>
  /** With `accountId`, clones with that account and binds the new repository to it. */
  /** With `recurseSubmodules`, a submodule that cannot be fetched does not fail the clone: its error comes back. */
  /** A clone that could not be bound to the account is kept too: `bindError` says why. */
  cloneRepo(
    url: string,
    dest: string,
    accountId?: string | null,
    recurseSubmodules?: boolean
  ): Promise<{ path: string; submoduleError: string | null; bindError: string | null }>
  watchRepo(repo: string): Promise<void>
  unwatchRepo(repo: string): Promise<void>

  // Reading
  getState(repo: string): Promise<RepoState>
  /** `scope`: branches hidden from the graph, or the only one shown (full ref names). */
  getLog(
    repo: string,
    limit: number,
    scope?: { hidden?: string[]; solo?: string | null }
  ): Promise<{ commits: Commit[]; hasMore: boolean }>
  getCommitDetails(repo: string, hash: string): Promise<CommitDetails>
  /** `fullFile`: also the unchanged lines around the hunks (`FileDiff.gaps`). */
  getDiff(repo: string, source: DiffSource, fullFile?: boolean): Promise<FileDiff>
  /** Refs, HEAD and the stash list; with `paths`, a copy of those files too (`tooLarge`: the ones too big to keep). */
  getSnapshot(repo: string, paths?: string[]): Promise<Snapshot>
  /** The files a stash changes (its untracked ones too): what applying or popping it touches. */
  stashPaths(repo: string, index: number, hash: string): Promise<string[]>
  /** Commits that touched a file, newest first, following renames; `limit` of them (`HISTORY_PAGE` by default). */
  getFileHistory(repo: string, path: string, rev: string | null, limit?: number): Promise<FileCommit[]>
  /** Commits that changed anything inside a folder, newest first; `limit` of them (`HISTORY_PAGE` by default). */
  getFolderHistory(repo: string, folder: string, rev: string | null, limit?: number): Promise<Commit[]>
  /** Who last changed each line: in the working tree (`rev` null) or in a commit. */
  getBlame(repo: string, path: string, rev: string | null): Promise<BlameLine[]>
  /** Stops git's work for the file view of `repo` (history, folder history or blame), which was closed. */
  stopFileView(repo: string): Promise<void>

  // Conflicts
  readWorkingFile(repo: string, path: string): Promise<WorkingFile>
  /** Refused when the file no longer holds `original`, the text the resolution was made from. */
  resolveConflictFile(repo: string, path: string, content: string, original: string): Promise<void>
  resolveConflictWith(repo: string, path: string, side: 'ours' | 'theirs'): Promise<void>
  /** Whether a conflicted file was edited since git left it (or cannot be known untouched). */
  conflictFileEdited(repo: string, path: string): Promise<boolean>
  /** Applies a recorded change; refuses when the repository no longer matches its starting state. */
  applyChange(repo: string, change: RepoChange): Promise<void>

  // Interactive rebase
  getRebaseCommits(repo: string, base: string): Promise<RebaseList>
  /** Refused when the branch no longer holds exactly the commits in `items`. */
  interactiveRebase(repo: string, base: string, items: RebaseItem[]): Promise<void>

  // Working tree
  stage(repo: string, paths: string[]): Promise<void>
  stageAll(repo: string): Promise<void>
  unstage(repo: string, paths: string[]): Promise<void>
  unstageAll(repo: string): Promise<void>
  discard(repo: string, paths: string[], untracked: string[]): Promise<void>
  /** Files back as HEAD has them (staged changes too), untracked ones deleted: what was in the way of a checkout. */
  restoreFromHead(repo: string, paths: string[], untracked: string[]): Promise<void>
  discardAll(repo: string): Promise<void>
  applyPatch(repo: string, patch: string, opts: { cached: boolean; reverse: boolean }): Promise<void>
  commit(repo: string, message: string, amend: boolean): Promise<void>
  headMessage(repo: string): Promise<string>
  ignore(repo: string, pattern: string): Promise<void>

  // Branches & refs
  // A checkout stopped by uncommitted changes in its way returns them (nothing changed); any other failure throws.
  checkout(repo: string, ref: string): Promise<CheckoutBlock | null>
  checkoutRemote(repo: string, remoteBranch: string): Promise<CheckoutBlock | null>
  checkoutDetached(repo: string, hash: string): Promise<CheckoutBlock | null>
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
  /** Stashes every change, or only those of `paths`. */
  stashSave(repo: string, message: string | null, paths?: string[]): Promise<void>
  /** `hash` must match `stash@{index}`; guards against the list changing meanwhile. */
  stashPop(repo: string, index: number, hash: string): Promise<void>
  stashApply(repo: string, index: number, hash: string): Promise<void>
  stashDrop(repo: string, index: number, hash: string): Promise<void>
  /** Untracked files of the stash that already exist: applying it leaves them out. */
  stashUntrackedClashes(repo: string, index: number, hash: string): Promise<string[]>
  /** Files the stash changes that have uncommitted changes, which make git refuse to apply it. */
  stashTrackedClashes(repo: string, index: number, hash: string): Promise<string[]>

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
  /** Whether a remote of the repository reaches `host`, also through an SSH alias. */
  repoUsesHost(repo: string, host: string): Promise<boolean>
  /** The message git's commit.template starts commits with, or null without one. */
  getCommitTemplate(repo: string): Promise<CommitDraftText | null>
  /** Who the next commit of a repository will be by, and where that comes from. */
  getCommitIdentity(repo: string): Promise<CommitIdentity>
  /** An account's identity, one typed, or the global one ('global') for the repository's next commits. */
  setCommitIdentity(repo: string, choice: { account: string } | Identity | 'global'): Promise<void>
  /** A repository with no identity of its own takes the one of the account that owns it or may push to it. */
  ensureDefaultIdentity(repo: string): Promise<void>
  /**
   * Authors' pictures (lowercased email -> data: URL, or null when there is none), when Settings shows avatars; a
   * commit of each (`hash`) lets the repository's server say who it is.
   */
  getAvatars(repo: string | null, people: { email: string; hash?: string }[]): Promise<Record<string, string | null>>
  /** Sign in to GitHub from the browser: the code to enter there, then the account once authorized. */
  startGitHubLogin(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }>
  finishGitHubLogin(): Promise<Account>
  cancelGitHubLogin(): Promise<void>
  /** Starts signing in to GitLab.com: the page to open in the browser, which comes back to the app. */
  startGitLabLogin(): Promise<{ url: string }>
  finishGitLabLogin(): Promise<Account>
  cancelGitLabLogin(): Promise<void>

  // Pull requests, through the account for the repository's remote (null: no such account)
  getPullRequests(repo: string): Promise<{ provider: Provider; remote: string; items: PullRequest[] } | null>
  createPullRequest(repo: string, input: NewPullRequest): Promise<PullRequest>
  /** Closes a pull request without merging it. */
  closePullRequest(repo: string, number: number, url: string): Promise<void>
  /** Fetches a pull request for review (nothing is checked out): its range and the files it changes. */
  reviewPullRequest(
    repo: string,
    pr: { number: number; sourceBranch: string; targetBranch: string; fromFork: boolean }
  ): Promise<{ base: string; head: string; files: FileChange[] }>
  getPullRequestComments(repo: string, number: number): Promise<PullRequestComment[]>
  commentOnPullRequest(repo: string, number: number, body: string): Promise<PullRequestComment>
  /** Approves the pull request at `head`, the commit the review showed (refused when it moved on). */
  approvePullRequest(repo: string, number: number, url: string, head: string): Promise<void>
  mergePullRequest(repo: string, number: number, url: string, method: MergeMethod, head: string): Promise<void>
  /** The merge methods the project allows for a pull request into `targetBranch`, its default first. */
  getMergeMethods(repo: string, targetBranch: string): Promise<MergeMethod[]>
  /** Ends a pull request's review: the ref holding its commits goes. */
  endPullRequestReview(repo: string, number: number): Promise<void>
  getDefaultBranch(repo: string): Promise<string | null>
  checkoutPullRequest(
    repo: string,
    remote: string,
    pr: { number: number; sourceBranch: string; fromFork: boolean },
    provider: Provider
  ): Promise<CheckoutBlock | null>
  /** Creates an ed25519 key in ~/.ssh; refuses to overwrite. */
  generateSshKey(opts: { email: string; passphrase: string; fileName: string }): Promise<SshKey>

  // External tools
  /** Opens a file (at a line), or the repository when `file` is null, in the editor chosen in Settings. */
  openInEditor(repo: string, file: string | null, line?: number): Promise<void>
  /** Shows one file's change in the diff tool; fails with NO_DIFF_TOOL when none is chosen or configured. */
  openDiffTool(repo: string, source: DiffSource): Promise<void>
  openMergeTool(repo: string, file: string): Promise<void>
  /** Folders given with `leviathan <folder>` before the window was ready (after restoring its tabs), once. */
  takeLaunchFolders(): Promise<string[]>
  /** Windows: adds the `leviathan` command to the user's PATH. */
  installCommandLine(): Promise<'added' | 'present'>
  /** How to get the `leviathan` command here: a button on Windows, a command to copy elsewhere. */
  commandLineInfo(): Promise<{ windows: boolean; packaged: boolean; command: string | null }>

  // Git LFS
  getLfsInfo(repo: string): Promise<LfsInfo>
  /** `background` never asks for credentials. `verified` is false when the server cannot tell whose locks they are. */
  /** `unsupported`: the server has no Git LFS locking API (Bitbucket Cloud). */
  getLfsLocks(
    repo: string,
    background?: boolean
  ): Promise<{ locks: LfsLock[]; verified: boolean; unsupported?: boolean }>
  lfsLock(repo: string, path: string): Promise<LfsLock>
  /** `force` releases someone else's lock. */
  lfsUnlock(repo: string, lock: { id: string; path: string }, force: boolean): Promise<void>
  lfsTrack(repo: string, pattern: string, lockable: boolean): Promise<void>
  lfsUntrack(repo: string, pattern: LfsPattern): Promise<void>
  /** Tracks the files' extensions and stages them again through LFS, with `.gitattributes`. */
  lfsMoveFiles(repo: string, paths: string[]): Promise<void>
  /** Stages again through LFS files that should go through it but were staged whole. */
  lfsRestage(repo: string, paths: string[]): Promise<void>
  /** Runs `git lfs install` and downloads the repository's LFS files. */
  setupLfs(repo: string): Promise<LfsSetup>
  /** How the app can install git-lfs on this computer. */
  getLfsInstallOffer(): Promise<LfsInstallOffer>
  /** Installs git-lfs (its progress shows on `repo`) and gives its version. */
  installGitLfs(repo: string): Promise<string>

  // Submodules
  getSubmodules(repo: string): Promise<Submodule[]>
  /** Initializes and checks out `paths` (or every submodule) at the recorded commits, recursively. */
  updateSubmodules(repo: string, paths: string[] | null): Promise<void>

  /** Starts a console in the repository's folder, with the shell for this system: its id, and that shell's program. */
  terminalStart(repo: string, cols: number, rows: number): Promise<{ id: number; shell: string }>
  /** Sends what was typed (or pasted) to a console. */
  terminalWrite(id: number, data: string): Promise<void>
  terminalResize(id: number, cols: number, rows: number): Promise<void>
  /** Ends a console and what runs in it. */
  terminalStop(id: number): Promise<void>
}

/** Output of a console of the panel at the bottom of a repository. */
export interface TerminalData {
  id: number
  data: string
}

/** A console whose shell ended (`exit` typed, or stopped). */
export interface TerminalExit {
  id: number
  code: number
}

/** Event subscriptions, and the platform, exposed next to the invoke methods. */
export interface LeviathanEventsApi {
  /** `process.platform` of the app: win32, darwin, linux… */
  readonly platform: string
  onRepoChanged(cb: (e: RepoChangedEvent) => void): () => void
  /** New Leviathan releases: found, downloading, ready to install. */
  onUpdate(cb: (state: UpdateState) => void): () => void
  /** `leviathan <folder>` was run while the app was open. */
  onOpenFolder(cb: (folder: string) => void): () => void
  onProgress(cb: (e: ProgressEvent) => void): () => void
  onAskpass(cb: (e: AskpassRequest) => void): () => void
  onTerminalData(cb: (e: TerminalData) => void): () => void
  onTerminalExit(cb: (e: TerminalExit) => void): () => void
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
  getUpdateState: true,
  checkForUpdates: true,
  downloadUpdate: true,
  installUpdate: true,
  getReleaseNotes: true,
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
  stashPaths: true,
  getFileHistory: true,
  getFolderHistory: true,
  getBlame: true,
  stopFileView: true,
  readWorkingFile: true,
  resolveConflictFile: true,
  resolveConflictWith: true,
  conflictFileEdited: true,
  applyChange: true,
  getRebaseCommits: true,
  interactiveRebase: true,
  stage: true,
  stageAll: true,
  unstage: true,
  unstageAll: true,
  discard: true,
  restoreFromHead: true,
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
  stashUntrackedClashes: true,
  stashTrackedClashes: true,
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
  repoUsesHost: true,
  getCommitTemplate: true,
  getCommitIdentity: true,
  setCommitIdentity: true,
  ensureDefaultIdentity: true,
  getAvatars: true,
  startGitHubLogin: true,
  finishGitHubLogin: true,
  cancelGitHubLogin: true,
  startGitLabLogin: true,
  finishGitLabLogin: true,
  cancelGitLabLogin: true,
  getPullRequests: true,
  createPullRequest: true,
  closePullRequest: true,
  reviewPullRequest: true,
  getPullRequestComments: true,
  commentOnPullRequest: true,
  approvePullRequest: true,
  mergePullRequest: true,
  getMergeMethods: true,
  endPullRequestReview: true,
  getDefaultBranch: true,
  checkoutPullRequest: true,
  generateSshKey: true,
  openInEditor: true,
  openDiffTool: true,
  openMergeTool: true,
  takeLaunchFolders: true,
  installCommandLine: true,
  commandLineInfo: true,
  getLfsInfo: true,
  getLfsLocks: true,
  lfsLock: true,
  lfsUnlock: true,
  lfsTrack: true,
  lfsUntrack: true,
  lfsMoveFiles: true,
  lfsRestage: true,
  setupLfs: true,
  getLfsInstallOffer: true,
  installGitLfs: true,
  getSubmodules: true,
  updateSubmodules: true,
  terminalStart: true,
  terminalWrite: true,
  terminalResize: true,
  terminalStop: true
}

export const API_METHODS = Object.keys(METHODS) as (keyof LeviathanInvokeApi)[]

export const IPC_INVOKE = 'leviathan:invoke'
export const IPC_REPO_CHANGED = 'leviathan:repo-changed'
export const IPC_PROGRESS = 'leviathan:progress'
export const IPC_ASKPASS = 'leviathan:askpass'
export const IPC_UPDATE = 'leviathan:update'
export const IPC_OPEN_FOLDER = 'leviathan:open-folder'
export const IPC_TERMINAL_DATA = 'leviathan:terminal-data'
export const IPC_TERMINAL_EXIT = 'leviathan:terminal-exit'

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
