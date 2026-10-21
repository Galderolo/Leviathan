export interface Commit {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  /** Unix timestamp (seconds). */
  authorDate: number
  committerName: string
  committerEmail: string
  /** Unix timestamp (seconds). */
  commitDate: number
  subject: string
}

export type RefType = 'head' | 'remote' | 'tag'

export interface GitRef {
  /** Short name, e.g. `main`, `origin/main`, `v1.0.0`. */
  name: string
  /** Full name, e.g. `refs/heads/main`. */
  fullName: string
  type: RefType
  /** Commit the ref points at (peeled for annotated tags). */
  hash: string
  /** Remote name, for remote branches. */
  remote?: string
  /** Upstream short name, e.g. `origin/main`, for local branches. */
  upstream?: string
  ahead?: number
  behind?: number
  upstreamGone?: boolean
  /** True for the currently checked-out local branch. */
  isHead?: boolean
}

export interface Stash {
  index: number
  /** `stash@{0}` */
  ref: string
  hash: string
  /** Commit the stash was created on top of. */
  baseHash: string
  message: string
  date: number
}

export interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?'

export interface FileChange {
  path: string
  origPath?: string
  status: FileStatus
}

export interface WorkingStatus {
  staged: FileChange[]
  unstaged: FileChange[]
  conflicted: FileChange[]
}

export interface HeadInfo {
  /** Branch name, or null when detached. */
  branch: string | null
  /** HEAD commit, or null when the branch has no commits yet. */
  hash: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}

export type RepoOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null

export interface RepoState {
  path: string
  head: HeadInfo
  refs: GitRef[]
  stashes: Stash[]
  remotes: Remote[]
  status: WorkingStatus
  operation: RepoOperation
}

export interface CommitDetails {
  commit: Commit
  /** Full commit message (subject + body). */
  message: string
  files: FileChange[]
}

export type DiffLineType = 'add' | 'del' | 'ctx' | 'meta'

export interface DiffLine {
  type: DiffLineType
  oldNo?: number
  newNo?: number
  text: string
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
  /** Raw hunk text (header + body), ready to be fed to `git apply`. */
  patch: string
}

export interface FileDiff {
  path: string
  oldPath?: string
  binary: boolean
  /** Raw file header (`diff --git ...` up to `+++ ...`). */
  header: string
  hunks: DiffHunk[]
}

export type DiffSource =
  | { kind: 'unstaged'; path: string; untracked?: boolean; conflicted?: boolean }
  | { kind: 'staged'; path: string }
  | { kind: 'commit'; hash: string; parent: string | null; path: string; oldPath?: string }

export type PullMode = 'ff' | 'ff-only' | 'rebase'
export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface Settings {
  recentRepos: string[]
  openTabs: string[]
  activeTab: string | null
  pullMode: PullMode
  commitLimit: number
  language: 'auto' | 'en' | 'es'
  leftPanelWidth: number
  rightPanelWidth: number
  /** Last parent folder used for cloning. */
  cloneDir: string
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean }
}

export const DEFAULT_SETTINGS: Settings = {
  recentRepos: [],
  openTabs: [],
  activeTab: null,
  pullMode: 'ff',
  commitLimit: 2000,
  language: 'auto',
  leftPanelWidth: 240,
  rightPanelWidth: 360,
  cloneDir: ''
}

export interface SshKey {
  /** Path of the `.pub` file. */
  path: string
  /** e.g. `ssh-ed25519` */
  type: string
  comment: string
  /** The whole public key line, ready to paste into GitHub/GitLab. */
  publicKey: string
}

/** A git/ssh prompt (username, password, passphrase, host key confirmation) forwarded to the UI. */
export interface AskpassRequest {
  id: string
  prompt: string
}

export interface RepoChangedEvent {
  repo: string
  /** `git` when refs/HEAD/index changed, `workdir` for working tree edits only. */
  kind: 'git' | 'workdir'
}

export interface ProgressEvent {
  repo: string
  line: string
}
