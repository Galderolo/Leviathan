import type {
  Commit,
  CommitDetails,
  DiffSource,
  FileDiff,
  ProgressEvent,
  PullMode,
  RepoChangedEvent,
  RepoState,
  ResetMode,
  Settings
} from './types'

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
  cloneRepo(url: string, dest: string): Promise<string>
  watchRepo(repo: string): Promise<void>
  unwatchRepo(repo: string): Promise<void>

  // Reading
  getState(repo: string): Promise<RepoState>
  getLog(repo: string, limit: number): Promise<{ commits: Commit[]; hasMore: boolean }>
  getCommitDetails(repo: string, hash: string): Promise<CommitDetails>
  getDiff(repo: string, source: DiffSource): Promise<FileDiff>

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
  stashPop(repo: string, index: number): Promise<void>
  stashApply(repo: string, index: number): Promise<void>
  stashDrop(repo: string, index: number): Promise<void>

  // Remotes
  fetch(repo: string): Promise<void>
  pull(repo: string, mode: PullMode): Promise<void>
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
}

/** Event subscriptions exposed next to the invoke methods. */
export interface LeviathanEventsApi {
  onRepoChanged(cb: (e: RepoChangedEvent) => void): () => void
  onProgress(cb: (e: ProgressEvent) => void): () => void
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
  push: true,
  pushTag: true,
  addRemote: true,
  removeRemote: true,
  openTerminal: true,
  openPath: true,
  openRepoFile: true,
  showInFolder: true,
  openExternal: true
}

export const API_METHODS = Object.keys(METHODS) as (keyof LeviathanInvokeApi)[]

export const IPC_INVOKE = 'leviathan:invoke'
export const IPC_REPO_CHANGED = 'leviathan:repo-changed'
export const IPC_PROGRESS = 'leviathan:progress'

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
