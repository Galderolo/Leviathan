import type {
  AskpassRequest,
  DiffHunk,
  DiffSource,
  FileChange,
  FileDiff,
  GitRef,
  PullMode,
  ResetMode,
  Settings,
  Stash
} from '../../shared/types'
import { buildPartialPatch } from '../../shared/patch'
import { hasRemoteOnHost } from '../../shared/providers'
import { diffSnapshots, invertChange, type RepoChange } from '../../shared/undo'
import { isFetchDue } from './autofetch'
import { branchStartOptions } from './branchStart'
import { remotesToChooseFrom } from './pushTarget'
import { popRedo, popUndo, pushEntry } from './undoStack'
import { resolveLang, t } from './i18n'
import { getRepo, newRepoView, patchRepo, useStore, type BusyKind, type RepoView, type Tab } from './store'
import { confirmDialog, errorMessage, formDialog, promptText, toast } from './ui'
import { basename } from './utils'

const api = window.leviathan

const MAX_RECENT = 15
const stateSeq: Record<string, number> = {}
const logSeq: Record<string, number> = {}
const detailsSeq: Record<string, number> = {}
const diffSeq: Record<string, number> = {}

// ---------------------------------------------------------------------------
// App & tabs

let initialized = false

export async function initApp(): Promise<void> {
  if (initialized) return
  initialized = true
  const [settings, appVersion, gitVersion] = await Promise.all([
    api.getSettings(),
    api.appVersion(),
    api.gitVersion().catch(() => '')
  ])
  useStore.setState({
    settings,
    lang: resolveLang(settings.language),
    versions: { app: appVersion, git: gitVersion.replace(/^git version /, '') }
  })
  if (!gitVersion) toast('error', t('error.noGit'))

  const tabs: Tab[] = []
  const repos: Record<string, RepoView> = {}
  for (const saved of settings.openTabs) {
    try {
      const path = await api.openRepo(saved)
      if (repos[path]) continue
      tabs.push({ id: path, path })
      repos[path] = newRepoView(path, settings.commitLimit)
    } catch {
      // Repository moved or deleted since last session.
    }
  }
  if (!tabs.length) tabs.push(welcomeTab())
  const active = tabs.find((tab) => tab.path === settings.activeTab) ?? tabs[0]
  useStore.setState({ tabs, repos, activeTab: active.id, ready: true })

  const ordered = [active, ...tabs.filter((tab) => tab !== active)]
  for (const tab of ordered) {
    if (!tab.path) continue
    void api.watchRepo(tab.path)
    void refreshRepo(tab.path)
    void loadRepoAccount(tab.path)
  }
}

function welcomeTab(): Tab {
  return { id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, path: null }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const settings = await api.saveSettings(patch)
  useStore.setState({ settings, lang: resolveLang(settings.language) })
}

function persistTabs(): void {
  const { tabs, activeTab } = useStore.getState()
  const openTabs = tabs.filter((tab) => tab.path).map((tab) => tab.path!)
  const active = tabs.find((tab) => tab.id === activeTab)?.path ?? null
  void saveSettings({ openTabs, activeTab: active })
}

function addRecent(path: string): void {
  const recent = useStore.getState().settings.recentRepos.filter((p) => p !== path)
  void saveSettings({ recentRepos: [path, ...recent].slice(0, MAX_RECENT) })
}

export function removeRecent(path: string): void {
  void saveSettings({ recentRepos: useStore.getState().settings.recentRepos.filter((p) => p !== path) })
}

export function newTab(): void {
  const tab = welcomeTab()
  useStore.setState((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
}

export function setActiveTab(id: string): void {
  useStore.setState({ activeTab: id })
  persistTabs()
  const tab = useStore.getState().tabs.find((x) => x.id === id)
  if (tab?.path) void refreshRepo(tab.path)
}

export function cycleTab(delta: number): void {
  const { tabs, activeTab } = useStore.getState()
  if (tabs.length < 2) return
  const idx = tabs.findIndex((tab) => tab.id === activeTab)
  setActiveTab(tabs[(idx + delta + tabs.length) % tabs.length].id)
}

export function closeTab(id: string): void {
  const s = useStore.getState()
  const idx = s.tabs.findIndex((tab) => tab.id === id)
  if (idx === -1) return
  const tab = s.tabs[idx]
  const repos = { ...s.repos }
  if (tab.path) {
    void api.unwatchRepo(tab.path)
    delete repos[tab.path]
  }
  let tabs = s.tabs.filter((x) => x.id !== id)
  if (!tabs.length) tabs = [welcomeTab()]
  const activeTab = s.activeTab === id ? tabs[Math.min(idx, tabs.length - 1)].id : s.activeTab
  useStore.setState({ tabs, repos, activeTab })
  persistTabs()
}

export async function openRepository(input: string, tabId?: string): Promise<void> {
  const path = await api.openRepo(input)
  const s = useStore.getState()
  const existing = s.tabs.find((tab) => tab.path === path)
  if (existing) {
    // Opening a repository that is already open from a welcome tab: drop the welcome tab.
    if (tabId && tabId !== existing.id) {
      useStore.setState((st) => ({ tabs: st.tabs.filter((tab) => tab.id !== tabId) }))
    }
    setActiveTab(existing.id)
    addRecent(path)
    return
  }
  const target = tabId ? s.tabs.find((tab) => tab.id === tabId && tab.path === null) : undefined
  const tabs = target
    ? s.tabs.map((tab) => (tab.id === tabId ? { id: path, path } : tab))
    : [...s.tabs, { id: path, path }]
  useStore.setState({
    tabs,
    activeTab: path,
    repos: { ...s.repos, [path]: newRepoView(path, s.settings.commitLimit) }
  })
  addRecent(path)
  persistTabs()
  void api.watchRepo(path)
  void loadRepoAccount(path)
  await refreshRepo(path)
}

export async function browseAndOpen(tabId?: string): Promise<void> {
  const folder = await api.pickFolder(t('welcome.open'))
  if (!folder) return
  try {
    await openRepository(folder, tabId)
  } catch (err) {
    toast('error', errorMessage(err))
  }
}

export async function cloneRepository(
  url: string,
  dest: string,
  tabId: string,
  accountId: string | null = null
): Promise<boolean> {
  useStore.setState({ cloneProgress: t('clone.cloning') })
  try {
    const path = await api.cloneRepo(url, dest, accountId)
    toast('success', t('toast.cloned'))
    await openRepository(path, tabId)
    return true
  } catch (err) {
    toast('error', errorMessage(err))
    return false
  } finally {
    useStore.setState({ cloneProgress: null })
  }
}

/** Loads which account the repository uses (shown in the toolbar). */
export async function loadRepoAccount(path: string): Promise<void> {
  try {
    const [id, accounts] = await Promise.all([api.getRepoAccount(path), api.listAccounts()])
    patchRepo(path, { account: accounts.find((a) => a.id === id) ?? null })
  } catch {
    // not critical: the toolbar just shows no account
  }
}

/** Lets the user pick the account a repository uses for commits and push/pull. */
export async function chooseRepoAccount(path: string): Promise<void> {
  const [accounts, current] = await Promise.all([api.listAccounts(), api.getRepoAccount(path)])
  const values = await formDialog({
    title: t('dlg.repoAccount', { repo: basename(path) }),
    message: accounts.length ? t('dlg.repoAccountHint') : t('accounts.none'),
    confirmText: t('common.save'),
    fields: [
      {
        key: 'account',
        label: t('clone.account'),
        type: 'select',
        value: current ?? '',
        options: [
          { value: '', label: t('accounts.noneOption') },
          ...accounts.map((a) => ({ value: a.id, label: `${a.username}@${a.host} — ${a.name} <${a.email}>` }))
        ]
      }
    ]
  })
  if (!values) return
  const id = values.account || null
  try {
    await api.setRepoAccount(path, id)
    const account = accounts.find((a) => a.id === id) ?? null
    patchRepo(path, { account })
    if (account) toast('success', t('toast.repoAccountSet', { name: `${account.username}@${account.host}` }))
    if (account && !hasRemoteOnHost(getRepo(path)?.state?.remotes ?? [], account.host)) {
      toast('info', t('toast.accountHostMismatch', { host: account.host }))
    }
  } catch (err) {
    toast('error', errorMessage(err))
  }
}

export async function initRepository(path: string, branch: string, tabId: string): Promise<boolean> {
  try {
    const repo = await api.initRepo(path, branch)
    await openRepository(repo, tabId)
    return true
  } catch (err) {
    toast('error', errorMessage(err))
    return false
  }
}

/** Answers a git/ssh prompt (credentials, passphrase or unknown host key) with a dialog. */
export async function handleAskpass(request: AskpassRequest): Promise<void> {
  const prompt = request.prompt.trim()
  let value: string | null
  if (/\(yes\/no/i.test(prompt)) {
    const trust = await confirmDialog({
      title: t('askpass.hostTitle'),
      message: prompt,
      confirmText: t('askpass.trust')
    })
    value = trust ? 'yes' : 'no'
  } else {
    const secret = /pass(word|phrase)|token|\bpin\b/i.test(prompt)
    const values = await formDialog({
      title: t('askpass.title'),
      message: prompt,
      confirmText: t('askpass.continue'),
      fields: [
        { key: 'value', label: secret ? t('askpass.secret') : t('askpass.answer'), type: secret ? 'password' : 'text' }
      ]
    })
    value = values ? values.value : null
  }
  await api.answerAskpass(request.id, value)
}

export function handleProgress(repo: string, line: string): void {
  if (getRepo(repo)) patchRepo(repo, { progress: line })
  else if (useStore.getState().cloneProgress !== null) useStore.setState({ cloneProgress: line })
}

// ---------------------------------------------------------------------------
// Loading data

function changeCount(view: RepoView): number {
  const st = view.state?.status
  return st ? st.staged.length + st.unstaged.length + st.conflicted.length : 0
}

export async function refreshRepo(path: string, opts: { log?: boolean } = {}): Promise<void> {
  const withLog = opts.log ?? true
  const view = getRepo(path)
  if (!view) return
  const sSeq = (stateSeq[path] = (stateSeq[path] ?? 0) + 1)
  const lSeq = withLog ? (logSeq[path] = (logSeq[path] ?? 0) + 1) : 0

  const statePromise = api.getState(path).then(
    (state) => {
      if (stateSeq[path] !== sSeq || !getRepo(path)) return
      patchRepo(path, { state, error: null, loading: false })
      fixSelection(path)
      const v = getRepo(path)
      if (v?.diff && v.diff.source.kind !== 'commit') void reloadDiff(path)
    },
    (err) => {
      if (stateSeq[path] !== sSeq) return
      patchRepo(path, { error: errorMessage(err), loading: false })
    }
  )
  const logPromise = withLog
    ? api.getLog(path, view.limit).then(
        (log) => {
          if (logSeq[path] !== lSeq || !getRepo(path)) return
          patchRepo(path, { commits: log.commits, hasMore: log.hasMore })
          // A commit that disappeared (undo, reset, amend...) must not stay selected.
          const selection = getRepo(path)?.selection
          if (selection?.kind === 'commit' && !log.commits.some((c) => c.hash === selection.hash)) {
            patchRepo(path, { selection: null, details: null })
            fixSelection(path)
          }
        },
        (err) => {
          if (logSeq[path] !== lSeq) return
          toast('error', errorMessage(err))
        }
      )
    : Promise.resolve()
  await Promise.all([statePromise, logPromise])
}

/** Picks a sensible selection when nothing is selected or the WIP row disappeared. */
function fixSelection(path: string): void {
  const view = getRepo(path)
  if (!view?.state) return
  const hasChanges = changeCount(view) > 0
  const head = view.state.head.hash
  if (view.selection === null || (view.selection.kind === 'wip' && !hasChanges)) {
    if (hasChanges) selectWip(path)
    else if (head) void selectCommit(path, head)
    else patchRepo(path, { selection: null, details: null })
  }
}

export async function loadMore(path: string): Promise<void> {
  const view = getRepo(path)
  if (!view || !view.hasMore) return
  patchRepo(path, { limit: view.limit + useStore.getState().settings.commitLimit })
  await refreshRepo(path, { log: true })
}

// ---------------------------------------------------------------------------
// Selection & diffs

export function selectWip(path: string): void {
  patchRepo(path, (r) => ({
    selection: { kind: 'wip' },
    details: null,
    diff: r.diff && r.diff.source.kind !== 'commit' ? r.diff : null
  }))
}

export async function selectCommit(path: string, hash: string, scroll = false): Promise<void> {
  const view = getRepo(path)
  if (!view) return
  const stash = view.state?.stashes.find((s) => s.hash === hash)
  patchRepo(path, (r) => ({
    selection: stash ? { kind: 'stash', hash, index: stash.index } : { kind: 'commit', hash },
    details: r.details?.commit.hash === hash ? r.details : null,
    diff: r.diff && r.diff.source.kind === 'commit' && r.diff.source.hash === hash ? r.diff : null,
    scrollNonce: scroll ? r.scrollNonce + 1 : r.scrollNonce
  }))
  const seq = (detailsSeq[path] = (detailsSeq[path] ?? 0) + 1)
  try {
    const details = await api.getCommitDetails(path, hash)
    if (detailsSeq[path] !== seq) return
    patchRepo(path, { details })
  } catch (err) {
    if (detailsSeq[path] === seq) toast('error', errorMessage(err))
  }
}

export function selectStash(path: string, stash: Stash): void {
  void selectCommit(path, stash.hash, true)
}

export function selectRef(path: string, ref: GitRef): void {
  void selectCommit(path, ref.hash, true)
}

function sameSource(a: DiffSource, b: DiffSource): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function openDiff(path: string, source: DiffSource): Promise<void> {
  patchRepo(path, { diff: { source, data: null } })
  await loadDiff(path, source)
}

async function loadDiff(path: string, source: DiffSource): Promise<void> {
  // Reloads of the same file can overlap (watcher + operation refresh); only the latest may land.
  const seq = (diffSeq[path] = (diffSeq[path] ?? 0) + 1)
  const isCurrent = (r: RepoView) => diffSeq[path] === seq && !!r.diff && sameSource(r.diff.source, source)
  try {
    const data = await api.getDiff(path, source)
    patchRepo(path, (r) => (isCurrent(r) ? { diff: { source, data } } : {}))
  } catch (err) {
    patchRepo(path, (r) => (isCurrent(r) ? { diff: { source, data: null, error: errorMessage(err) } } : {}))
  }
}

async function reloadDiff(path: string): Promise<void> {
  const diff = getRepo(path)?.diff
  if (diff) await loadDiff(path, diff.source)
}

export function closeDiff(path: string): void {
  patchRepo(path, { diff: null })
}

export function setFilter(path: string, filter: string): void {
  patchRepo(path, { filter })
}

// ---------------------------------------------------------------------------
// Running git operations

/**
 * Runs `fn` and records what it changed (refs and HEAD) so it can be undone.
 * Errors propagate; nothing is recorded when nothing changed.
 */
async function recordUndo<T>(path: string, label: string, mode: RepoChange['mode'], fn: () => Promise<T>): Promise<T> {
  const before = await api.getSnapshot(path).catch(() => null)
  const result = await fn()
  const after = before ? await api.getSnapshot(path).catch(() => null) : null
  const change = before && after ? diffSnapshots(before, after, mode) : null
  if (change) patchRepo(path, (r) => pushEntry(r, { label, change }))
  return result
}

async function runOp(
  path: string,
  fn: () => Promise<unknown>,
  opts: { busy?: BusyKind; success?: string; log?: boolean; undo?: { label: string; mode?: RepoChange['mode'] } } = {}
): Promise<boolean> {
  if (opts.busy) patchRepo(path, { busy: opts.busy, progress: null })
  try {
    if (opts.undo) await recordUndo(path, opts.undo.label, opts.undo.mode ?? 'keep', fn)
    else await fn()
    if (opts.success) toast('success', opts.success)
    return true
  } catch (err) {
    toast('error', errorMessage(err))
    return false
  } finally {
    if (opts.busy) patchRepo(path, { busy: null, progress: null })
    await refreshRepo(path, { log: opts.log ?? true })
  }
}

function headBranch(path: string): string | null {
  return getRepo(path)?.state?.head.branch ?? null
}

function defaultRemote(path: string): string | null {
  const remotes = getRepo(path)?.state?.remotes ?? []
  return remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? null
}

export async function fetchAll(path: string): Promise<boolean> {
  const ok = await runOp(path, () => api.fetch(path), { busy: 'fetch', success: t('toast.fetched') })
  if (ok) patchRepo(path, { lastFetchAt: Date.now(), lastFetchError: null })
  return ok
}

/** Quiet fetch used by auto-fetch: no prompts, no toasts; errors go to the status bar. */
export async function fetchInBackground(path: string): Promise<void> {
  const view = getRepo(path)
  if (!view?.state?.remotes.length || view.busy) return
  patchRepo(path, { lastFetchAt: Date.now() })
  try {
    await api.fetch(path, true)
    patchRepo(path, { lastFetchError: null })
    await refreshRepo(path)
  } catch (err) {
    patchRepo(path, { lastFetchError: errorMessage(err) })
  }
}

/** Runs due background fetches for every open repository. */
export function autoFetchTick(): void {
  const { tabs, repos, settings } = useStore.getState()
  const now = Date.now()
  for (const tab of tabs) {
    const view = tab.path ? repos[tab.path] : undefined
    if (view && isFetchDue(view.lastFetchAt, now, settings.autoFetchMinutes)) void fetchInBackground(view.path)
  }
}

export async function pull(path: string, mode?: PullMode): Promise<boolean> {
  const settings = useStore.getState().settings
  const effective = mode ?? settings.pullMode
  if (mode && mode !== settings.pullMode) void saveSettings({ pullMode: mode })
  return runOp(path, () => api.pull(path, effective), {
    busy: 'pull',
    success: t('toast.pulled'),
    undo: { label: t('undo.pull') }
  })
}

export async function push(path: string, opts: { force?: boolean; branch?: string } = {}): Promise<boolean> {
  const branch = opts.branch ?? headBranch(path)
  if (!branch) {
    toast('error', t('error.detachedPush'))
    return false
  }
  if (opts.force) {
    const ok = await confirmDialog({
      title: t('menu.forcePush'),
      message: t('dlg.forcePush', { branch }),
      confirmText: t('menu.forcePush'),
      danger: true
    })
    if (!ok) return false
  }
  const state = getRepo(path)?.state
  const choices = state ? remotesToChooseFrom(branch, state.refs, state.remotes) : null
  let remote: string | undefined
  if (choices) {
    const values = await formDialog({
      title: t('dlg.publishBranch', { branch }),
      confirmText: t('toolbar.push'),
      fields: [
        {
          key: 'remote',
          label: t('dlg.remote'),
          type: 'select',
          value: choices.includes('origin') ? 'origin' : choices[0],
          options: choices.map((name) => ({ value: name, label: name }))
        }
      ]
    })
    if (!values) return false
    remote = values.remote
  }
  return runOp(path, () => api.push(path, { force: !!opts.force, branch: opts.branch, remote }), {
    busy: 'push',
    success: t('toast.pushed', { branch })
  })
}

/** Asks for the name and the starting point (preselected: `startHash`, or HEAD). */
export async function createBranch(path: string, startHash: string | null): Promise<void> {
  const view = getRepo(path)
  if (!view?.state) return
  const start = branchStartOptions(view.state.head, view.state.refs, view.commits, startHash)
  const values = await formDialog({
    title: t('dlg.newBranch'),
    confirmText: t('dlg.create'),
    fields: [
      { key: 'name', label: t('dlg.branchName'), placeholder: 'feature/my-change' },
      { key: 'start', label: t('dlg.startPoint'), type: 'select', value: start.value, options: start.options }
    ]
  })
  const name = values?.name?.trim()
  if (!name) return
  const startPoint = values!.start === 'HEAD' ? null : values!.start
  await runOp(path, () => api.createBranch(path, name, startPoint, true), {
    undo: { label: t('undo.createBranch', { name }) }
  })
}

export async function stashChanges(path: string, askMessage = false): Promise<void> {
  const view = getRepo(path)
  if (!view || changeCount(view) === 0) {
    toast('info', t('toast.nothingToStash'))
    return
  }
  let message: string | null = null
  if (askMessage) {
    const values = await formDialog({
      title: t('menu.stashChanges'),
      confirmText: t('toolbar.stash'),
      fields: [{ key: 'message', label: t('dlg.stashMessage') }]
    })
    if (!values) return
    message = values.message || null
  }
  await runOp(path, () => api.stashSave(path, message))
}

/** Pops `stash`, or the most recent stash when none is given (toolbar Pop). */
export async function popStash(path: string, stash?: Stash): Promise<void> {
  const target = stash ?? getRepo(path)?.state?.stashes[0]
  if (!target) {
    toast('info', t('toast.noStashes'))
    return
  }
  await runOp(path, () => api.stashPop(path, target.index, target.hash))
}

export function applyStash(path: string, stash: Stash): Promise<boolean> {
  return runOp(path, () => api.stashApply(path, stash.index, stash.hash))
}

export async function dropStash(path: string, stash: Stash): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.stashDrop'),
    message: t('dlg.dropStash', { name: stash.message }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (ok) await runOp(path, () => api.stashDrop(path, stash.index, stash.hash))
}

export function checkoutRef(path: string, ref: GitRef): Promise<boolean> {
  const undo = { label: t('undo.checkout', { name: ref.name }) }
  if (ref.type === 'head') return runOp(path, () => api.checkout(path, ref.name), { undo })
  if (ref.type === 'remote') return runOp(path, () => api.checkoutRemote(path, ref.name), { undo })
  return runOp(path, () => api.checkoutDetached(path, ref.name), { undo })
}

export function checkoutCommit(path: string, hash: string): Promise<boolean> {
  return runOp(path, () => api.checkoutDetached(path, hash), {
    undo: { label: t('undo.checkout', { name: hash.slice(0, 7) }) }
  })
}

export function mergeRef(path: string, name: string): Promise<boolean> {
  return runOp(path, () => api.merge(path, name), { undo: { label: t('undo.merge', { name }) } })
}

/** Checks out the local branch `into` and merges `from` into it. */
export function checkoutAndMerge(path: string, into: string, from: string): Promise<boolean> {
  return runOp(
    path,
    async () => {
      await api.checkout(path, into)
      await api.merge(path, from)
    },
    { undo: { label: t('undo.merge', { name: from }) } }
  )
}

export function rebaseOnto(path: string, name: string): Promise<boolean> {
  return runOp(path, () => api.rebase(path, name), { undo: { label: t('undo.rebase', { name }) } })
}

export async function deleteBranch(path: string, ref: GitRef): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.delete', { name: ref.name }),
    message: t('dlg.deleteBranch', { name: ref.name }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (!ok) return
  try {
    await recordUndo(path, t('undo.deleteBranch', { name: ref.name }), 'keep', () =>
      api.deleteBranch(path, ref.name, false)
    )
  } catch (err) {
    const msg = errorMessage(err)
    if (!/not fully merged/i.test(msg)) {
      toast('error', msg)
      return
    }
    const force = await confirmDialog({
      title: t('menu.delete', { name: ref.name }),
      message: t('dlg.deleteBranchForce', { name: ref.name }),
      confirmText: t('dlg.delete'),
      danger: true
    })
    if (force) {
      await runOp(path, () => api.deleteBranch(path, ref.name, true), {
        undo: { label: t('undo.deleteBranch', { name: ref.name }) }
      })
    }
    return
  }
  await refreshRepo(path)
}

export async function renameBranch(path: string, ref: GitRef): Promise<void> {
  const name = await promptText({
    title: t('dlg.renameBranch'),
    label: t('dlg.branchName'),
    value: ref.name,
    confirmText: t('dlg.rename')
  })
  if (name && name !== ref.name) {
    await runOp(path, () => api.renameBranch(path, ref.name, name), {
      undo: { label: t('undo.renameBranch', { name: ref.name }) }
    })
  }
}

export async function deleteRemoteBranch(path: string, ref: GitRef): Promise<void> {
  if (!ref.remote) return
  const ok = await confirmDialog({
    title: t('menu.deleteRemote', { name: ref.name }),
    message: t('dlg.deleteRemoteBranch', { name: ref.name }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (!ok) return
  const branch = ref.name.slice(ref.remote.length + 1)
  await runOp(path, () => api.deleteRemoteBranch(path, ref.remote!, branch), { busy: 'push' })
}

export async function createTag(path: string, hash: string): Promise<void> {
  const values = await formDialog({
    title: t('dlg.newTag'),
    confirmText: t('dlg.create'),
    fields: [
      { key: 'name', label: t('dlg.tagName'), placeholder: 'v1.0.0' },
      { key: 'message', label: t('dlg.tagMessage'), multiline: true }
    ]
  })
  const name = values?.name?.trim()
  if (!name) return
  await runOp(path, () => api.createTag(path, name, hash, values!.message || null), {
    undo: { label: t('undo.createTag', { name }) }
  })
}

export async function deleteTag(path: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.deleteTag', { name }),
    message: t('dlg.deleteTag', { name }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (ok) await runOp(path, () => api.deleteTag(path, name), { undo: { label: t('undo.deleteTag', { name }) } })
}

export async function pushTag(path: string, name: string): Promise<void> {
  const remote = defaultRemote(path)
  if (!remote) {
    toast('error', t('error.noRemote'))
    return
  }
  await runOp(path, () => api.pushTag(path, remote, name), {
    busy: 'push',
    success: t('toast.pushed', { branch: name })
  })
}

export function cherryPick(path: string, hash: string): Promise<boolean> {
  return runOp(path, () => api.cherryPick(path, hash), {
    undo: { label: t('undo.cherryPick', { name: hash.slice(0, 7) }) }
  })
}

export function revertCommit(path: string, hash: string): Promise<boolean> {
  return runOp(path, () => api.revert(path, hash), { undo: { label: t('undo.revert', { name: hash.slice(0, 7) }) } })
}

export async function resetTo(path: string, hash: string, mode: ResetMode): Promise<void> {
  if (mode === 'hard') {
    const ok = await confirmDialog({
      title: t('menu.resetHard', { branch: headBranch(path) ?? 'HEAD' }),
      message: t('dlg.resetHard'),
      confirmText: t('dlg.continue'),
      danger: true
    })
    if (!ok) return
  }
  await runOp(path, () => api.reset(path, hash, mode), { undo: { label: t('undo.reset', { name: hash.slice(0, 7) }) } })
}

export function abortOperation(path: string): Promise<boolean> {
  return runOp(path, () => api.abortOperation(path))
}

export function continueOperation(path: string): Promise<boolean> {
  return runOp(path, () => api.continueOperation(path))
}

// ---------------------------------------------------------------------------
// Working tree

/** Both sides of a rename must be (un)staged together. */
function withOrigPaths(files: FileChange[]): string[] {
  return files.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]))
}

export function stageFiles(path: string, files: FileChange[]): Promise<boolean> {
  return runOp(path, () => api.stage(path, withOrigPaths(files)), { log: false })
}

export function stageAll(path: string): Promise<boolean> {
  return runOp(path, () => api.stageAll(path), { log: false })
}

export function unstageFiles(path: string, files: FileChange[]): Promise<boolean> {
  return runOp(path, () => api.unstage(path, withOrigPaths(files)), { log: false })
}

export function unstageAll(path: string): Promise<boolean> {
  return runOp(path, () => api.unstageAll(path), { log: false })
}

export async function discardFiles(path: string, files: FileChange[]): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.discard'),
    message: t('dlg.discardFile', { name: files.length === 1 ? files[0].path : String(files.length) }),
    confirmText: t('menu.discard'),
    danger: true
  })
  if (!ok) return
  const tracked = files.filter((f) => f.status !== '?').map((f) => f.path)
  const untracked = files.filter((f) => f.status === '?').map((f) => f.path)
  await runOp(path, () => api.discard(path, tracked, untracked), { log: false })
}

export async function discardAll(path: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.discardAll'),
    message: t('dlg.discardAll'),
    confirmText: t('menu.discardAll'),
    danger: true
  })
  if (ok) await runOp(path, () => api.discardAll(path), { log: false })
}

export function ignorePattern(path: string, pattern: string): Promise<boolean> {
  return runOp(path, () => api.ignore(path, pattern), { log: false })
}

/** Stages or unstages only the selected lines of a hunk. */
export async function applyLines(
  path: string,
  diff: FileDiff,
  hunk: DiffHunk,
  selected: Set<number>,
  mode: 'stage' | 'unstage'
): Promise<void> {
  if (getRepo(path)?.applying) return
  const patch = buildPartialPatch(diff.header, hunk, selected, mode === 'unstage')
  if (!patch) return
  patchRepo(path, { applying: true })
  try {
    await runOp(path, () => api.applyPatch(path, patch, { cached: true, reverse: mode === 'unstage' }), { log: false })
    await reloadDiff(path)
  } finally {
    patchRepo(path, { applying: false })
  }
}

export async function applyHunk(
  path: string,
  diff: FileDiff,
  hunk: DiffHunk,
  mode: 'stage' | 'unstage' | 'discard'
): Promise<void> {
  // The hunk on screen is only valid until the patch lands; ignore clicks until the diff reloads.
  if (getRepo(path)?.applying) return
  if (mode === 'discard') {
    const ok = await confirmDialog({
      title: t('diff.discardHunk'),
      message: t('dlg.discardHunk'),
      confirmText: t('diff.discardHunk'),
      danger: true
    })
    if (!ok) return
  }
  const patch = diff.header + hunk.patch
  const opts =
    mode === 'stage'
      ? { cached: true, reverse: false }
      : mode === 'unstage'
        ? { cached: true, reverse: true }
        : { cached: false, reverse: true }
  patchRepo(path, { applying: true })
  try {
    await runOp(path, () => api.applyPatch(path, patch, opts), { log: false })
    await reloadDiff(path)
  } finally {
    patchRepo(path, { applying: false })
  }
}

export function updateDraft(path: string, patch: Partial<RepoView['draft']>): void {
  patchRepo(path, (r) => ({ draft: { ...r.draft, ...patch } }))
}

export async function setAmend(path: string, amend: boolean): Promise<void> {
  const view = getRepo(path)
  if (!view) return
  if (amend && !view.draft.summary.trim() && !view.draft.body.trim()) {
    const message = await api.headMessage(path).catch(() => '')
    const [summary, ...rest] = message.split('\n')
    updateDraft(path, { amend, summary: summary ?? '', body: rest.join('\n').trim() })
  } else {
    updateDraft(path, { amend })
  }
}

export async function commit(path: string): Promise<boolean> {
  const view = getRepo(path)
  if (!view) return false
  const { summary, body, amend } = view.draft
  const message = body.trim() ? `${summary.trim()}\n\n${body.trim()}\n` : `${summary.trim()}\n`
  const ok = await runOp(path, () => api.commit(path, message, amend), {
    undo: { label: t(amend ? 'undo.amend' : 'undo.commit', { name: summary.trim() }), mode: 'soft' }
  })
  if (ok) {
    updateDraft(path, { summary: '', body: '', amend: false })
    patchRepo(path, { diff: null })
  }
  return ok
}

// ---------------------------------------------------------------------------
// Undo / redo

async function applyHistory(path: string, direction: 'undo' | 'redo'): Promise<void> {
  const view = getRepo(path)
  if (!view || view.busy) return
  const popped = direction === 'undo' ? popUndo(view) : popRedo(view)
  if (!popped) {
    toast('info', t(direction === 'undo' ? 'toast.nothingToUndo' : 'toast.nothingToRedo'))
    return
  }
  const { entry } = popped
  try {
    await api.applyChange(path, direction === 'undo' ? invertChange(entry.change) : entry.change)
    patchRepo(path, popped.stacks)
    toast('success', t(direction === 'undo' ? 'toast.undone' : 'toast.redone', { label: entry.label }))
  } catch (err) {
    // The repository moved on: this entry can no longer be applied, so drop it.
    patchRepo(path, (r) =>
      direction === 'undo' ? { undo: r.undo.filter((e) => e !== entry) } : { redo: r.redo.filter((e) => e !== entry) }
    )
    toast('error', errorMessage(err))
  } finally {
    await refreshRepo(path)
  }
}

export function undo(path: string): Promise<void> {
  return applyHistory(path, 'undo')
}

export function redo(path: string): Promise<void> {
  return applyHistory(path, 'redo')
}

// ---------------------------------------------------------------------------
// Remotes & shell

export async function addRemote(path: string): Promise<void> {
  const values = await formDialog({
    title: t('dlg.addRemote'),
    confirmText: t('dlg.add'),
    fields: [
      { key: 'name', label: t('dlg.remoteName'), value: getRepo(path)?.state?.remotes.length ? '' : 'origin' },
      { key: 'url', label: t('dlg.remoteUrl'), placeholder: 'https://github.com/user/repo.git' }
    ]
  })
  const name = values?.name?.trim()
  const url = values?.url?.trim()
  if (name && url) await runOp(path, () => api.addRemote(path, name, url))
}

export async function removeRemote(path: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.removeRemote', { name }),
    message: t('dlg.removeRemote', { name }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (ok) await runOp(path, () => api.removeRemote(path, name))
}

export function openTerminal(path: string): void {
  api.openTerminal(path).catch((err) => toast('error', errorMessage(err)))
}

export function openInFileManager(path: string): void {
  api.openPath(path).catch((err) => toast('error', errorMessage(err)))
}

export function openFile(repo: string, file: string): void {
  api
    .openRepoFile(repo, file)
    .then((result) => result === 'revealed' && toast('info', t('toast.revealedExecutable')))
    .catch((err) => toast('error', errorMessage(err)))
}

export function showFileInFolder(repo: string, file: string): void {
  void api.showInFolder(joinPath(repo, file))
}

export function openExternal(url: string): void {
  void api.openExternal(url)
}

function joinPath(repo: string, file: string): string {
  const sep = repo.includes('\\') ? '\\' : '/'
  return repo.replace(/[\\/]+$/, '') + sep + file.replace(/\//g, sep)
}

export function repoName(path: string): string {
  return basename(path)
}
