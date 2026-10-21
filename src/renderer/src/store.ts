import { create } from 'zustand'
import type { Account, Commit, CommitDetails, DiffSource, FileDiff, RepoState, Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
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
  /** Actions that can be undone (newest last) and undone actions that can be redone. */
  undo: UndoEntry[]
  redo: UndoEntry[]
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
  cloneProgress: string | null
  versions: { app: string; git: string }
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
  cloneProgress: null,
  versions: { app: '', git: '' }
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
