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
  /** Unix time of the tip commit (or of the tag for annotated tags). */
  date?: number
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
  /** Commits of the checked-out branch that are not pushed yet, newest first. */
  unpushed: string[]
  /** Changed files (staged, unstaged or conflicted) that go through Git LFS. */
  lfsFiles: string[]
  /** Staged files over `LARGE_FILE_BYTES` that do not go through Git LFS. */
  largeFiles: { path: string; size: number }[]
  /** Staged files that should go through Git LFS but are staged with their whole content. */
  unconvertedLfs: { path: string; size: number }[]
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
  /** For a submodule: the commits the change brings or takes away. */
  submodule?: SubmoduleChange
}

export interface SubmoduleChange {
  /** Commit before the change (null when the submodule is new). */
  from: string | null
  /** Commit after the change (null when it is removed). */
  to: string | null
  /** Newest first; `added` false for commits the change takes away. At most 100 each way. */
  commits: { hash: string; subject: string; added: boolean }[]
  /** The submodule is not checked out here or lacks those commits, so they cannot be listed. */
  missing: boolean
}

/** A submodule of the repository. */
export interface Submodule {
  /** Name in `.gitmodules` (usually its path). */
  name: string
  path: string
  url: string
  /** Commit the repository records for it. */
  recorded: string
  /** Commit checked out inside it; null when it is not initialized. */
  current: string | null
  /** `outOfSync`: another commit than the recorded one is checked out. */
  state: 'uninitialized' | 'clean' | 'outOfSync' | 'conflict'
  /** Files changed inside it, not committed there. */
  dirty: boolean
}

/** A commit that touched a file, with the file's path in that commit. */
export interface FileCommit {
  commit: Commit
  path: string
  /** The path before, when this commit renamed or copied the file. */
  oldPath?: string
  /** A, M, D, R, C... (empty for a merge that did not change it against its first parent). */
  status: string
}

/** One line of a blamed file, and the commit that last changed it. */
export interface BlameLine {
  /** All zeros for a line not committed yet. */
  hash: string
  author: string
  /** Unix seconds. */
  date: number
  summary: string
  /** 1-based line number in the file. */
  line: number
  text: string
}

/** An open pull request (a merge request on GitLab). */
export interface PullRequest {
  number: number
  title: string
  author: string
  sourceBranch: string
  targetBranch: string
  draft: boolean
  /** Web page of the pull request. */
  url: string
  /** The source branch lives in another repository (a fork). */
  fromFork: boolean
  updatedAt: string
}

export interface NewPullRequest {
  title: string
  body: string
  /** Branch with the changes. */
  source: string
  /** Branch to merge into. */
  target: string
  draft: boolean
}

/** A commit offered for an interactive rebase. */
export interface RebaseCommit {
  hash: string
  subject: string
  /** Full message, without trailing whitespace. */
  message: string
  author: string
  /** Author date, unix seconds. */
  date: number
}

/** A working-tree file read whole as text, or why it cannot be edited as text. */
export type WorkingFile = { text: string; reason: null } | { text: null; reason: 'binary' | 'large' | 'encoding' }

export type DiffSource =
  | { kind: 'unstaged'; path: string; untracked?: boolean; conflicted?: boolean }
  | { kind: 'staged'; path: string }
  | {
      kind: 'commit'
      hash: string
      parent: string | null
      path: string
      oldPath?: string
      /** An untracked file of a stash, kept in the stash's third parent. */
      untracked?: boolean
    }

export type PullMode = 'ff' | 'ff-only' | 'rebase'
export type ThemeSetting = 'dark' | 'light' | 'system'
export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface Settings {
  recentRepos: string[]
  openTabs: string[]
  activeTab: string | null
  pullMode: PullMode
  commitLimit: number
  language: 'auto' | 'en' | 'es'
  theme: ThemeSetting
  leftPanelWidth: number
  rightPanelWidth: number
  /** Last parent folder used for cloning. */
  cloneDir: string
  /** Background fetch interval in minutes; 0 disables it. */
  autoFetchMinutes: number
  /** Look for new Leviathan releases on GitHub. */
  autoUpdate: boolean
  /** Push the branch right after each commit. */
  pushAfterCommit: boolean
  /** Version that ran last: a newer one opens "What's new" once. */
  lastSeenVersion: string
  /** Command that opens a file in the user's editor ({file}, {line}, {folder}); empty: the system's default app. */
  editor: string
  /** Diff and merge tool for `git difftool` / `git mergetool`; empty: the one set in git's config. */
  diffTool: string
  /** Repository path -> id of the account it uses. */
  repoAccounts: Record<string, string>
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean }
}

export const DEFAULT_SETTINGS: Settings = {
  recentRepos: [],
  openTabs: [],
  activeTab: null,
  pullMode: 'ff',
  commitLimit: 2000,
  language: 'auto',
  theme: 'system',
  leftPanelWidth: 240,
  rightPanelWidth: 360,
  cloneDir: '',
  autoFetchMinutes: 10,
  autoUpdate: true,
  pushAfterCommit: false,
  lastSeenVersion: '',
  editor: '',
  diffTool: '',
  repoAccounts: {}
}

export type Provider = 'github' | 'gitlab' | 'gitea' | 'other'

/** A hosting account. The token is never part of this object; it stays encrypted in the main process. */
export interface Account {
  id: string
  provider: Provider
  host: string
  username: string
  /** Commit author name used in repositories bound to this account. */
  name: string
  /** Commit email; the provider's no-reply address by default. */
  email: string
}

export interface RemoteRepo {
  fullName: string
  cloneUrl: string
  private: boolean
  description: string
  updatedAt: string
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
