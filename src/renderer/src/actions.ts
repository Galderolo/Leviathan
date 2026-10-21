import type {
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
import { resolveLang, t } from './i18n'
import { getRepo, newRepoView, patchRepo, useStore, type BusyKind, type RepoView, type Tab } from './store'
import { confirmDialog, errorMessage, formDialog, promptText, toast } from './ui'
import { basename } from './utils'

const api = window.calamar

const MAX_RECENT = 15
const stateSeq: Record<string, number> = {}
const logSeq: Record<string, number> = {}
const detailsSeq: Record<string, number> = {}

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

export async function cloneRepository(url: string, dest: string, tabId: string): Promise<boolean> {
  useStore.setState({ cloneProgress: t('clone.cloning') })
  try {
    const path = await api.cloneRepo(url, dest)
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
  try {
    const data = await api.getDiff(path, source)
    patchRepo(path, (r) => (r.diff && sameSource(r.diff.source, source) ? { diff: { source, data } } : {}))
  } catch (err) {
    patchRepo(path, (r) =>
      r.diff && sameSource(r.diff.source, source) ? { diff: { source, data: null, error: errorMessage(err) } } : {}
    )
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

async function runOp(
  path: string,
  fn: () => Promise<unknown>,
  opts: { busy?: BusyKind; success?: string; log?: boolean } = {}
): Promise<boolean> {
  if (opts.busy) patchRepo(path, { busy: opts.busy, progress: null })
  try {
    await fn()
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

export function fetchAll(path: string): Promise<boolean> {
  return runOp(path, () => api.fetch(path), { busy: 'fetch', success: t('toast.fetched') })
}

export async function pull(path: string, mode?: PullMode): Promise<boolean> {
  const settings = useStore.getState().settings
  const effective = mode ?? settings.pullMode
  if (mode && mode !== settings.pullMode) void saveSettings({ pullMode: mode })
  return runOp(path, () => api.pull(path, effective), { busy: 'pull', success: t('toast.pulled') })
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
  return runOp(path, () => api.push(path, { force: !!opts.force, branch: opts.branch }), {
    busy: 'push',
    success: t('toast.pushed', { branch })
  })
}

export async function createBranch(path: string, startPoint: string | null): Promise<void> {
  const name = await promptText({
    title: t('dlg.newBranch'),
    label: t('dlg.branchName'),
    placeholder: 'feature/my-change',
    confirmText: t('dlg.create')
  })
  if (!name) return
  await runOp(path, () => api.createBranch(path, name, startPoint, true))
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

export async function popStash(path: string, index = 0): Promise<void> {
  if (!getRepo(path)?.state?.stashes.length) {
    toast('info', t('toast.noStashes'))
    return
  }
  await runOp(path, () => api.stashPop(path, index))
}

export function applyStash(path: string, index: number): Promise<boolean> {
  return runOp(path, () => api.stashApply(path, index))
}

export async function dropStash(path: string, stash: Stash): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.stashDrop'),
    message: t('dlg.dropStash', { name: stash.message }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (ok) await runOp(path, () => api.stashDrop(path, stash.index))
}

export function checkoutRef(path: string, ref: GitRef): Promise<boolean> {
  if (ref.type === 'head') return runOp(path, () => api.checkout(path, ref.name))
  if (ref.type === 'remote') return runOp(path, () => api.checkoutRemote(path, ref.name))
  return runOp(path, () => api.checkoutDetached(path, ref.name))
}

export function checkoutCommit(path: string, hash: string): Promise<boolean> {
  return runOp(path, () => api.checkoutDetached(path, hash))
}

export function mergeRef(path: string, name: string): Promise<boolean> {
  return runOp(path, () => api.merge(path, name))
}

export function rebaseOnto(path: string, name: string): Promise<boolean> {
  return runOp(path, () => api.rebase(path, name))
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
    await api.deleteBranch(path, ref.name, false)
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
    if (force) await runOp(path, () => api.deleteBranch(path, ref.name, true))
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
  if (name && name !== ref.name) await runOp(path, () => api.renameBranch(path, ref.name, name))
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
  await runOp(path, () => api.createTag(path, name, hash, values!.message || null))
}

export async function deleteTag(path: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.deleteTag', { name }),
    message: t('dlg.deleteTag', { name }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (ok) await runOp(path, () => api.deleteTag(path, name))
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
  return runOp(path, () => api.cherryPick(path, hash))
}

export function revertCommit(path: string, hash: string): Promise<boolean> {
  return runOp(path, () => api.revert(path, hash))
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
  await runOp(path, () => api.reset(path, hash, mode))
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

export async function applyHunk(
  path: string,
  diff: FileDiff,
  hunk: DiffHunk,
  mode: 'stage' | 'unstage' | 'discard'
): Promise<void> {
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
  await runOp(path, () => api.applyPatch(path, patch, opts), { log: false })
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
  const ok = await runOp(path, () => api.commit(path, message, amend))
  if (ok) {
    updateDraft(path, { summary: '', body: '', amend: false })
    patchRepo(path, { diff: null })
  }
  return ok
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
  api.openPath(joinPath(repo, file)).catch((err) => toast('error', errorMessage(err)))
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
