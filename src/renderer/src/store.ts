import { create } from 'zustand'
import type {
  Account,
  Commit,
  CommitDetails,
  DiffSource,
  FileDiff,
  Provider,
  PullRequest,
  RebaseCommit,
  RepoSettingKey,
  RepoState,
  Settings,
  Submodule
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { settingsFor } from '../../shared/repoSettings'
import type { CommitIdentity } from '../../shared/identity'
import type { CommitDraftText } from '../../shared/commitTemplate'
import type { LfsInfo, LfsLock } from '../../shared/lfs'
import type { LfsInstallOffer } from '../../shared/lfsInstall'
import type { UpdateState } from '../../shared/updates'
import type { Lang } from './i18n'
import type { UndoEntry } from './undoStack'

export type Selection =
  { kind: 'wip' } | { kind: 'commit'; hash: string } | { kind: 'stash'; hash: string; index: number } | null

export type BusyKind = 'fetch' | 'pull' | 'push' | 'lfs' | 'submodules'

export interface DiffView {
  source: DiffSource
  data: FileDiff | null
  error?: string
}

export interface CommitDraft {
  summary: string
  body: string
  amend: boolean
}

export interface RepoView {
  path: string
  state: RepoState | null
  commits: Commit[]
  hasMore: boolean
  limit: number
  loading: boolean
  error: string | null
  /** Long-running network operation in progress. */
  busy: BusyKind | null
  progress: string | null
  selection: Selection
  details: CommitDetails | null
  diff: DiffView | null
  filter: string
  draft: CommitDraft
  /** Incremented to ask the graph to scroll the selection into view. */
  scrollNonce: number
  /** A hunk patch is being applied; the diff on screen is about to change. */
  applying: boolean
  lastFetchAt: number | null
  /** Error of the last background fetch, shown in the status bar. */
  lastFetchError: string | null
  /** Account bound to this repository, if any. */
  account: Account | null
  /** Who the next commit will be by; null until read. */
  identity: CommitIdentity | null
  /** git's commit.template, the message each commit starts from; null without one. */
  template: CommitDraftText | null
  /** Open pull requests; null when no account can reach the repository's remote. */
  pullRequests: PullRequestsView | null
  /** Branches left out of the graph, or the only one shown (full ref names). */
  graphScope: GraphScope
  /** Branch picked in the side panel (full ref name): the graph dims commits outside its history. */
  highlight: string | null
  /** History or blame of a file, or history of a folder (`path`), from HEAD or from commit `rev`. */
  fileView: FileView | null
  /** The pull request under review in the center panel. */
  review: PullRequest | null
  /** Actions that can be undone (newest last) and undone actions that can be redone. */
  undo: UndoEntry[]
  redo: UndoEntry[]
  /** Git LFS patterns and locks; null until read. */
  lfs: LfsView | null
  submodules: Submodule[]
  /** The terminal at the bottom shows (its consoles live on while hidden). */
  terminalOpen: boolean
  /** The terminal's consoles, in tab order (`shell`: its program, once started), and the one showing. */
  consoles: { key: number; shell: string }[]
  activeConsole: number | null
}

/** File history, blame or folder history shown in place of the graph. */
export interface FileView {
  kind: 'history' | 'blame' | 'folder'
  path: string
  rev: string | null
  /** Blame: the line to show first. */
  line?: number
  /** Blames left to look before a change, newest last, to come back to. */
  back?: FileView[]
}

export interface LfsView {
  info: LfsInfo
  locks: LfsLock[]
  /** The server told which locks are the user's. */
  verified: boolean
  /** The server has no Git LFS locking API (Bitbucket Cloud): no locks, nothing to lock. */
  locksUnsupported: boolean
  locksError: string | null
  locksLoading: boolean
}

export interface PullRequestsView {
  provider: Provider | null
  /** Remote the pull requests belong to. */
  remote: string | null
  items: PullRequest[]
  error: string | null
}

export interface GraphScope {
  hidden: string[]
  solo: string | null
}

const SCOPE_KEY = 'leviathan.graphScope:'

/** What the graph showed last time for this repository (kept per repository, on this computer). */
export function readGraphScope(path: string): GraphScope {
  try {
    const saved = JSON.parse(localStorage.getItem(SCOPE_KEY + path) ?? 'null')
    if (saved && Array.isArray(saved.hidden))
      return {
        hidden: saved.hidden.filter((r: unknown) => typeof r === 'string'),
        solo: typeof saved.solo === 'string' ? saved.solo : null
      }
  } catch {
    // ignore: show everything
  }
  return { hidden: [], solo: null }
}

export function writeGraphScope(path: string, scope: GraphScope): void {
  try {
    if (!scope.hidden.length && !scope.solo) localStorage.removeItem(SCOPE_KEY + path)
    else localStorage.setItem(SCOPE_KEY + path, JSON.stringify(scope))
  } catch {
    // not critical: the next start shows every branch
  }
}

export type DiffLayout = 'unified' | 'split'
export const DIFF_LAYOUT_KEY = 'leviathan.diffLayout'

function initialDiffLayout(): DiffLayout {
  try {
    return localStorage.getItem(DIFF_LAYOUT_KEY) === 'split' ? 'split' : 'unified'
  } catch {
    return 'unified'
  }
}

export const DIFF_FULL_FILE_KEY = 'leviathan.diffFullFile'

function initialDiffFullFile(): boolean {
  try {
    return localStorage.getItem(DIFF_FULL_FILE_KEY) === '1'
  } catch {
    return false
  }
}

export interface Tab {
  id: string
  /** null for a "new tab" (welcome screen). */
  path: string | null
}

export type MenuItem =
  | {
      label: string
      onClick: () => void
      danger?: boolean
      disabled?: boolean
      hint?: string
    }
  | { separator: true }

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export type SettingsSection = 'general' | 'repo' | 'tools' | 'accounts' | 'ssh' | 'updates' | 'shortcuts' | 'about'

export interface FormField {
  key: string
  label: string
  value?: string
  placeholder?: string
  multiline?: boolean
  /** `checklist`: a checkbox per option; the value is the checked ones, one per line. */
  type?: 'text' | 'select' | 'number' | 'password' | 'checklist'
  options?: { value: string; label: string; note?: string }[]
}

/** A button of a dialog that offers several ways on; `primary` is the one Enter picks. */
export interface DialogChoice {
  key: string
  label: string
  danger?: boolean
  primary?: boolean
}

export interface DialogState {
  title: string
  message?: string
  /** Shown below the message, one per line (file names). */
  list?: string[]
  /** Shown below the list. */
  note?: string
  fields: FormField[]
  confirmText: string
  danger?: boolean
  /** Buttons in place of the confirm one, in this order; the dialog resolves with `{ choice: key }`. */
  choices?: DialogChoice[]
  resolve: (values: Record<string, string> | null) => void
}

export interface Toast {
  id: number
  kind: 'error' | 'success' | 'info'
  text: string
}

export interface AppState {
  ready: boolean
  settings: Settings
  lang: Lang
  tabs: Tab[]
  activeTab: string | null
  repos: Record<string, RepoView>
  menu: MenuState | null
  dialog: DialogState | null
  toasts: Toast[]
  settingsOpen: boolean
  /** The section Settings shows (the last one shown, unless something opens another). */
  settingsSection: SettingsSection
  whatsNewOpen: boolean
  /** Interactive rebase dialog: the commits after `base` in repository `path`. */
  rebase: { path: string; base: string; commits: RebaseCommit[]; script: string | null } | null
  cloneProgress: string | null
  versions: { app: string; git: string }
  /** How diffs are shown: one column, or old and new side by side. */
  diffLayout: DiffLayout
  /** Diffs show the whole file, not only the lines around each change. */
  diffFullFile: boolean
  /** Newer Leviathan releases, as the main process last reported. */
  update: UpdateState | null
  /** Authors' pictures (lowercased email -> data: URL, null when there is none), when Settings shows avatars. */
  avatars: Record<string, string | null>
  /** How the app can install git-lfs on this computer (asked once). */
  lfsOffer: LfsInstallOffer | null
  /** git-lfs is being installed (for any repository). */
  lfsInstalling: boolean
}

export const useStore = create<AppState>(() => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  lang: 'en',
  tabs: [],
  activeTab: null,
  repos: {},
  menu: null,
  dialog: null,
  toasts: [],
  settingsOpen: false,
  settingsSection: 'general',
  whatsNewOpen: false,
  rebase: null,
  cloneProgress: null,
  versions: { app: '', git: '' },
  diffLayout: initialDiffLayout(),
  diffFullFile: initialDiffFullFile(),
  update: null,
  avatars: {},
  lfsOffer: null,
  lfsInstalling: false
}))

export function newRepoView(path: string, limit: number): RepoView {
  return {
    path,
    state: null,
    commits: [],
    hasMore: false,
    limit,
    loading: true,
    error: null,
    busy: null,
    progress: null,
    selection: null,
    details: null,
    diff: null,
    filter: '',
    draft: { summary: '', body: '', amend: false },
    scrollNonce: 0,
    applying: false,
    lastFetchAt: null,
    lastFetchError: null,
    account: null,
    identity: null,
    template: null,
    pullRequests: null,
    fileView: null,
    review: null,
    graphScope: readGraphScope(path),
    highlight: null,
    undo: [],
    redo: [],
    lfs: null,
    submodules: [],
    terminalOpen: false,
    consoles: [],
    activeConsole: null
  }
}

export function patchRepo(path: string, patch: Partial<RepoView> | ((r: RepoView) => Partial<RepoView>)): void {
  useStore.setState((s) => {
    const current = s.repos[path]
    if (!current) return s
    const next = typeof patch === 'function' ? patch(current) : patch
    return { repos: { ...s.repos, [path]: { ...current, ...next } } }
  })
}

export function getRepo(path: string): RepoView | undefined {
  return useStore.getState().repos[path]
}

export function useRepo(path: string): RepoView | undefined {
  return useStore((s) => s.repos[path])
}

export function useActiveTab(): Tab | undefined {
  return useStore((s) => s.tabs.find((t) => t.id === s.activeTab))
}

/** A setting as repository `path` sees it: its own value, or the general one. */
export function useRepoSetting<K extends RepoSettingKey>(path: string | null, key: K): Settings[K] {
  return useStore((s) => settingsFor(s.settings, path)[key])
}
