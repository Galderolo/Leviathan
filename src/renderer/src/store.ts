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
  RepoState,
  Settings
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { UpdateState } from '../../shared/updates'
import type { Lang } from './i18n'
import type { UndoEntry } from './undoStack'

export type Selection =
  { kind: 'wip' } | { kind: 'commit'; hash: string } | { kind: 'stash'; hash: string; index: number } | null

export type BusyKind = 'fetch' | 'pull' | 'push'

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
  /** Open pull requests; null when no account can reach the repository's remote. */
  pullRequests: PullRequestsView | null
  /** Branches left out of the graph, or the only one shown (full ref names). */
  graphScope: GraphScope
  /** Tip of the branch picked in the side panel: the graph dims commits outside its history. */
  highlight: string | null
  /** File history or blame shown in place of the graph. */
  fileView: { kind: 'history' | 'blame'; path: string; rev: string | null } | null
  /** Actions that can be undone (newest last) and undone actions that can be redone. */
  undo: UndoEntry[]
  redo: UndoEntry[]
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

export interface FormField {
  key: string
  label: string
  value?: string
  placeholder?: string
  multiline?: boolean
  type?: 'text' | 'select' | 'number' | 'password'
  options?: { value: string; label: string }[]
}

export interface DialogState {
  title: string
  message?: string
  fields: FormField[]
  confirmText: string
  danger?: boolean
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
  /** Interactive rebase dialog: the commits after `base` in repository `path`. */
  rebase: { path: string; base: string; commits: RebaseCommit[] } | null
  cloneProgress: string | null
  versions: { app: string; git: string }
  /** How diffs are shown: one column, or old and new side by side. */
  diffLayout: DiffLayout
  /** Newer Leviathan releases, as the main process last reported. */
  update: UpdateState | null
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
  rebase: null,
  cloneProgress: null,
  versions: { app: '', git: '' },
  diffLayout: initialDiffLayout(),
  update: null
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
    pullRequests: null,
    fileView: null,
    graphScope: readGraphScope(path),
    highlight: null,
    undo: [],
    redo: []
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
