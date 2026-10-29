import type {
  AskpassRequest,
  BlameLine,
  Commit,
  DiffHunk,
  DiffSource,
  FileChange,
  FileDiff,
  GitRef,
  MergeMethod,
  PullRequest,
  PullMode,
  RepoSettingKey,
  RepoState,
  ResetMode,
  Settings,
  Stash,
  Submodule
} from '../../shared/types'
import type { ChangesBlock } from '../../shared/localChanges'
import type { LfsLock, LfsPattern } from '../../shared/lfs'
import { canInstall } from '../../shared/lfsInstall'
import type { ReleaseNote } from '../../shared/releaseNotes'
import { buildPartialPatch } from '../../shared/patch'
import { needsPushForPullRequest } from '../../shared/forge'
import type { RebaseItem } from '../../shared/rebase'
import { ownSettings, settingsFor, withRepoSetting } from '../../shared/repoSettings'
import { diffSnapshots, invertChange, type RepoChange } from '../../shared/undo'
import type { Identity } from '../../shared/identity'
import { isFetchDue } from './autofetch'
import { coalesce } from './coalesce'
import { followDiff, sameDiff } from './diffFollow'
import { attributesChanged, lfsInfoKey, patternLabel } from './lfsView'
import { discardSummary } from './fileSelection'
import { branchStartOptions } from './branchStart'
import { amendsPushedCommit, pushAfterCommitTarget, remotesToChooseFrom, pushNeedsPull } from './pushTarget'
import { stopReason, stoppedOperation } from './operationStop'
import { viewAfterCheckout, wipShown } from './checkoutView'
import { moveTab } from './tabOrder'
import { addConsole, closeTerminal } from './terminals'
import { inFlight } from './inFlight'
import { isStaleUndoError, popRedo, popUndo, pushEntry, staleHistoryKey, undoModeForReset } from './undoStack'
import { resolveLang, t } from './i18n'
import {
  DIFF_FULL_FILE_KEY,
  getRepo,
  newRepoView,
  patchRepo,
  useStore,
  writeGraphScope,
  type BusyKind,
  type GraphScope,
  type LfsView,
  type RepoView,
  type Tab
} from './store'
import { choiceDialog, confirmDialog, copyText, errorMessage, formDialog, promptText, toast } from './ui'
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
  // Before the tabs load: a repository that needs git-lfs asks to install it the way this computer can.
  await loadLfsOffer()
  // First start of a new version (not of the app itself): show what changed, once.
  if (settings.lastSeenVersion !== appVersion) {
    if (settings.lastSeenVersion) useStore.setState({ whatsNewOpen: true })
    void saveSettings({ lastSeenVersion: appVersion })
  }

  const tabs: Tab[] = []
  const repos: Record<string, RepoView> = {}
  for (const saved of settings.openTabs) {
    try {
      const path = await api.openRepo(saved)
      if (repos[path]) continue
      tabs.push({ id: path, path })
      repos[path] = newRepoView(path, settingsFor(settings, path).commitLimit)
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
  for (const folder of await api.takeLaunchFolders().catch(() => [])) await openFromCommandLine(folder)
}

function welcomeTab(): Tab {
  return { id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, path: null }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const settings = await api.saveSettings(patch)
  useStore.setState({ settings, lang: resolveLang(settings.language) })
}

/** The settings as repository `path` sees them: its own values over the general ones. */
export function repoSettings(path: string | null): Settings {
  return settingsFor(useStore.getState().settings, path)
}

/** Gives a repository a value of its own for `key`, or the general one again with `undefined`. */
export function saveRepoSetting<K extends RepoSettingKey>(
  path: string,
  key: K,
  value: Settings[K] | undefined
): Promise<void> {
  return saveSettings({ repoSettings: withRepoSetting(useStore.getState().settings.repoSettings, path, key, value) })
}

/**
 * Saves a setting changed from a repository's own screen (the Pull menu, the commit box): as the repository's value
 * when it has one of its own, as the general one otherwise.
 */
export function saveSettingFor<K extends RepoSettingKey>(path: string, key: K, value: Settings[K]): Promise<void> {
  if (ownSettings(useStore.getState().settings, path)[key] !== undefined) return saveRepoSetting(path, key, value)
  return saveSettings({ [key]: value } as Partial<Settings>)
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
  // Its LFS info, when already read, is not read again: ask from what is known.
  if (tab?.path) void askToInstallGitLfs(tab.path)
}

/** Moves tab `id` into gap `gap` of the tab bar (0 = first place). */
export function reorderTab(id: string, gap: number): void {
  const { tabs } = useStore.getState()
  const next = moveTab(tabs, id, gap)
  if (next === tabs) return
  useStore.setState({ tabs: next })
  persistTabs()
}

/** Shows or hides the terminal at the bottom of a repository (its consoles go on while hidden); the first time, opens one. */
export function toggleTerminal(path: string): void {
  const view = getRepo(path)
  if (!view) return
  if (!view.terminalOpen && !view.consoles.length) return addConsole(path)
  patchRepo(path, (r) => ({ terminalOpen: !r.terminalOpen }))
}

/** Shows tab `n` (1 = the first); 9 is the last one, as in browsers. */
export function goToTab(n: number): void {
  const { tabs } = useStore.getState()
  const tab = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]
  if (tab) setActiveTab(tab.id)
}

export function cycleTab(delta: number): void {
  const { tabs, activeTab } = useStore.getState()
  if (tabs.length < 2) return
  const idx = tabs.findIndex((tab) => tab.id === activeTab)
  setActiveTab(tabs[(idx + delta + tabs.length) % tabs.length].id)
}

export function closeTab(id: string): void {
  const s = useStore.getState()
  const tab = s.tabs.find((x) => x.id === id)
  // git-lfs is being installed from it: closing it does not stop that, say so first.
  if (tab?.path && s.lfsInstalling && s.repos[tab.path]?.busy === 'lfs') {
    void confirmDialog({
      title: t('tab.close'),
      message: t('dlg.closeWhileLfsInstalls'),
      confirmText: t('tab.close')
    }).then((ok) => ok && closeTabNow(id))
    return
  }
  closeTabNow(id)
}

function closeTabNow(id: string): void {
  const s = useStore.getState()
  const idx = s.tabs.findIndex((tab) => tab.id === id)
  if (idx === -1) return
  const tab = s.tabs[idx]
  const repos = { ...s.repos }
  if (tab.path) {
    void api.unwatchRepo(tab.path)
    closeTerminal(tab.path)
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
    repos: { ...s.repos, [path]: newRepoView(path, settingsFor(s.settings, path).commitLimit) }
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
  accountId: string | null = null,
  recurseSubmodules = true
): Promise<boolean> {
  useStore.setState({ cloneProgress: t('clone.cloning') })
  try {
    const { path, submoduleError, bindError } = await api.cloneRepo(url, dest, accountId, recurseSubmodules)
    toast('success', t('toast.cloned'))
    if (bindError) toast('error', t('toast.accountNotBound', { error: bindError }))
    if (submoduleError) toast('error', t('toast.submodulesNotCloned', { error: submoduleError }))
    await openRepository(path, tabId)
    return true
  } catch (err) {
    toast('error', errorMessage(err))
    return false
  } finally {
    useStore.setState({ cloneProgress: null })
  }
}

/** Loads which account the repository uses (shown in the toolbar), and its pull requests. */
/** Authors already asked for this session (whatever the answer): each is asked once. */
const avatarsAsked = new Set<string>()

/** The pictures of the authors of `commits` not asked for yet, when Settings shows avatars. */
export async function loadAvatars(path: string | null, commits: Pick<Commit, 'authorEmail' | 'hash'>[]): Promise<void> {
  if (!useStore.getState().settings.avatars) return
  const people: { email: string; hash: string }[] = []
  for (const c of commits) {
    const email = c.authorEmail.trim().toLowerCase()
    if (!email || avatarsAsked.has(email)) continue
    avatarsAsked.add(email)
    people.push({ email, hash: c.hash })
  }
  if (!people.length) return
  try {
    const found = await api.getAvatars(path, people)
    useStore.setState((s) => ({ avatars: { ...s.avatars, ...found } }))
  } catch {
    // Asked again with the next commits shown.
    for (const p of people) avatarsAsked.delete(p.email)
  }
}

/** Shows avatars, or stops: the pictures of the commits already shown are fetched, or dropped. */
export async function setAvatars(on: boolean): Promise<void> {
  await saveSettings({ avatars: on })
  avatarsAsked.clear()
  useStore.setState({ avatars: {} })
  if (!on) return
  for (const view of Object.values(useStore.getState().repos)) void loadAvatars(view.path, view.commits)
}

/** The account a repository is bound to, and who its next commit will be by. */
async function loadAccountAndIdentity(path: string): Promise<void> {
  try {
    const [id, accounts, identity] = await Promise.all([
      api.getRepoAccount(path),
      api.listAccounts(),
      api.getCommitIdentity(path)
    ])
    patchRepo(path, { account: accounts.find((a) => a.id === id) ?? null, identity })
  } catch {
    // not critical: the toolbar just shows no account, the commit box no identity
  }
}

/** A commit box with nothing typed in it: empty, or the template it was given. */
function draftUntouched(view: RepoView): boolean {
  const { summary, body } = view.draft
  if (!summary.trim() && !body.trim()) return true
  return !!view.template && summary === view.template.summary && body === view.template.body
}

/** Reads git's commit.template, and gives it to a commit box with nothing typed in it. */
async function loadCommitTemplate(path: string): Promise<void> {
  const template = await api.getCommitTemplate(path).catch(() => null)
  patchRepo(path, (r) => ({
    template,
    ...(template && !r.draft.amend && !r.draft.summary.trim() && !r.draft.body.trim()
      ? { draft: { ...r.draft, ...template } }
      : {})
  }))
}

export async function loadRepoAccount(path: string): Promise<void> {
  void loadCommitTemplate(path)
  await loadAccountAndIdentity(path)
  void loadPullRequests(path)
  // A repository with no identity of its own takes the one of the account that owns it or may push to it.
  void api.ensureDefaultIdentity(path).then(
    () => loadAccountAndIdentity(path),
    () => {}
  )
}

/** Sets who the repository's next commits are by: an account's identity, one typed, or the global one. */
export async function chooseCommitIdentity(
  path: string,
  choice: { account: string } | Identity | 'global'
): Promise<void> {
  try {
    await api.setCommitIdentity(path, choice)
    // Identities typed are remembered in the settings.
    useStore.setState({ settings: await api.getSettings() })
  } catch (err) {
    toast('error', errorMessage(err))
  }
  await loadAccountAndIdentity(path)
  void loadPullRequests(path)
}

/** Asks for a name and an email for the repository's next commits. */
export async function askCommitIdentity(path: string): Promise<void> {
  const current = getRepo(path)?.identity
  const values = await formDialog({
    title: t('identity.title'),
    fields: [
      { key: 'name', label: t('identity.name'), value: current?.name ?? '' },
      { key: 'email', label: t('identity.email'), value: current?.email ?? '' }
    ],
    confirmText: t('identity.use')
  })
  if (values) await chooseCommitIdentity(path, { name: values.name, email: values.email })
}

const prSeq: Record<string, number> = {}

/** Loads the open pull requests, when an account can reach the repository's remote. */
export async function loadPullRequests(path: string): Promise<void> {
  const seq = (prSeq[path] = (prSeq[path] ?? 0) + 1)
  try {
    const result = await api.getPullRequests(path)
    if (prSeq[path] !== seq) return
    patchRepo(path, { pullRequests: result && { ...result, error: null } })
  } catch (err) {
    if (prSeq[path] !== seq) return
    patchRepo(path, (r) => ({
      pullRequests: {
        provider: r.pullRequests?.provider ?? null,
        remote: r.pullRequests?.remote ?? null,
        items: r.pullRequests?.items ?? [],
        error: errorMessage(err)
      }
    }))
  }
}

/** Accounts were added or removed: every open repository may now see (or no longer see) its pull requests. */
export function reloadAllPullRequests(): void {
  for (const path of Object.keys(useStore.getState().repos)) void loadRepoAccount(path)
}

/** Closes a pull request on the server, without merging it, after asking. */
export async function closePullRequest(path: string, pr: PullRequest): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.closePr'),
    message: t('dlg.closePr', { number: pr.number, title: pr.title }),
    confirmText: t('menu.closePr'),
    danger: true
  })
  if (!ok) return
  try {
    await api.closePullRequest(path, pr.number, pr.url)
    toast('success', t('toast.prClosed', { number: pr.number }))
  } catch (err) {
    toast('error', errorMessage(err))
  } finally {
    void loadPullRequests(path)
  }
}

/** Opens a pull request's review in the center panel: its files and their diff, and its conversation. */
export function openReview(path: string, pr: PullRequest): void {
  patchRepo(path, { review: pr, fileView: null, diff: null })
}

export function closeReview(path: string): void {
  patchRepo(path, { review: null })
}

/** Approves the reviewed pull request at `head`, the commit the review showed. */
export async function approveReviewedPullRequest(path: string, pr: PullRequest, head: string): Promise<void> {
  try {
    await api.approvePullRequest(path, pr.number, pr.url, head)
    toast('success', t('toast.prApproved', { number: pr.number }))
  } catch (err) {
    toast('error', errorMessage(err))
  }
}

/** Merges the reviewed pull request on the provider, the way the user picks among those the project allows. */
export async function mergeReviewedPullRequest(path: string, pr: PullRequest, head: string): Promise<void> {
  let methods: MergeMethod[]
  try {
    methods = await api.getMergeMethods(path, pr.targetBranch)
  } catch (err) {
    toast('error', errorMessage(err))
    return
  }
  const values = await formDialog({
    title: t('review.mergeTitle', { number: pr.number }),
    message: t('review.mergeHint', { source: pr.sourceBranch, target: pr.targetBranch }),
    confirmText: t('review.merge'),
    fields: [
      {
        key: 'method',
        label: t('review.mergeMethod'),
        type: 'select',
        value: methods[0],
        options: methods.map((m) => ({ value: m, label: t(`review.method.${m}`) }))
      }
    ]
  })
  if (!values) return
  try {
    await api.mergePullRequest(path, pr.number, pr.url, values.method as MergeMethod, head)
    toast('success', t('toast.prMerged', { number: pr.number }))
    closeReview(path)
    // The merge happened on the provider: bring it here.
    void fetchAll(path)
  } catch (err) {
    toast('error', errorMessage(err))
  } finally {
    void loadPullRequests(path)
  }
}

export async function checkoutPullRequest(path: string, pr: PullRequest): Promise<boolean> {
  const info = getRepo(path)?.pullRequests
  if (!info?.provider || !info.remote) return false
  const { provider, remote } = info
  const checkout = () =>
    api.checkoutPullRequest(
      path,
      remote,
      { number: pr.number, sourceBranch: pr.sourceBranch, fromFork: pr.fromFork },
      provider
    )
  // It fetches the pull request's branch first.
  return switchTo(path, '#' + pr.number, checkout, 'fetch')
}

/**
 * Opens a pull request for a local branch. A branch that is not on the pull
 * requests' remote yet, or has commits that are not, is pushed first.
 */
export async function createPullRequestFor(path: string, ref: GitRef): Promise<void> {
  const remote = getRepo(path)?.pullRequests?.remote
  if (!remote) return
  const find = (refs: GitRef[] | undefined) => refs?.find((r) => r.type === 'head' && r.name === ref.name)
  const refs = getRepo(path)?.state?.refs ?? []
  if (needsPushForPullRequest(find(refs) ?? ref, remote, refs)) {
    if (!(await push(path, { branch: ref.name }))) return
  }
  // Read the state again: a refresh started meanwhile may not have landed in the store yet.
  const state = await api.getState(path).catch(() => null)
  const branch = find(state?.refs)
  if (!state || !branch || needsPushForPullRequest(branch, remote, state.refs)) {
    toast('error', t('error.prRemote', { name: ref.name, remote }))
    return
  }
  const source = ref.name
  const targets = state.refs
    .filter((r) => r.type === 'remote' && r.remote === remote && !r.name.endsWith('/HEAD'))
    .map((r) => r.name.slice(remote.length + 1))
    .filter((name) => name !== source)
  const preferred = await api.getDefaultBranch(path).catch(() => null)
  const target = preferred && targets.includes(preferred) ? preferred : (targets[0] ?? '')
  const subject = getRepo(path)?.commits.find((c) => c.hash === branch.hash)?.subject ?? ref.name
  const values = await formDialog({
    title: t('dlg.createPr', { name: ref.name }),
    confirmText: t('dlg.createPrConfirm'),
    fields: [
      { key: 'title', label: t('dlg.prTitle'), value: subject },
      { key: 'body', label: t('dlg.prBody'), multiline: true, value: '' },
      {
        key: 'target',
        label: t('dlg.prTarget'),
        type: 'select',
        value: target,
        options: targets.map((name) => ({ value: name, label: remote + '/' + name }))
      },
      {
        key: 'draft',
        label: t('dlg.prDraft'),
        type: 'select',
        value: 'no',
        options: [
          { value: 'no', label: t('dlg.prReady') },
          { value: 'yes', label: t('dlg.prIsDraft') }
        ]
      }
    ]
  })
  if (!values) return
  try {
    const pr = await api.createPullRequest(path, {
      title: values.title,
      body: values.body,
      source,
      target: values.target,
      draft: values.draft === 'yes'
    })
    toast('success', t('toast.prCreated', { number: pr.number }))
    if (pr.url) openExternal(pr.url)
  } catch (err) {
    toast('error', errorMessage(err))
  } finally {
    void loadPullRequests(path)
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
    void loadPullRequests(path)
    if (account) toast('success', t('toast.repoAccountSet', { name: `${account.username}@${account.host}` }))
    // Asked to the main process: it sees the real host behind an SSH alias (git@github-work:…).
    if (account && !(await api.repoUsesHost(path, account.host).catch(() => true))) {
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

// Refreshes requested while one runs (file changes that never stop, actions finishing) become one more refresh
// after it, instead of piling up and throwing each other's results away.
const refreshCoalesced = coalesce(
  (path: string, opts: { log: boolean }) => refreshRepoNow(path, opts.log),
  (a, b) => ({ log: a.log || b.log })
)

export function refreshRepo(path: string, opts: { log?: boolean } = {}): Promise<void> {
  return refreshCoalesced(path, { log: opts.log ?? true })
}

async function refreshRepoNow(path: string, withLog: boolean): Promise<void> {
  const view = getRepo(path)
  if (!view) return
  const sSeq = (stateSeq[path] = (stateSeq[path] ?? 0) + 1)
  const lSeq = withLog ? (logSeq[path] = (logSeq[path] ?? 0) + 1) : 0

  const statePromise = api.getState(path).then(
    (state) => {
      if (stateSeq[path] !== sSeq || !getRepo(path)) return
      patchRepo(path, { state, error: null, loading: false })
      fixSelection(path)
      followLfs(path, state)
      // Submodules change with commits and checkouts; once known, edits inside them count too.
      if (withLog || getRepo(path)?.submodules.length) void loadSubmodules(path)
      const v = getRepo(path)
      if (v?.diff && v.diff.source.kind !== 'commit') {
        // The file may have been staged, unstaged or discarded meanwhile: follow it, or close the diff.
        const next = followDiff(v.diff.source, state.status)
        if (!next) closeDiff(path)
        else if (next !== v.diff.source) void openDiff(path, next)
        else void reloadDiff(path)
      }
    },
    (err) => {
      if (stateSeq[path] !== sSeq) return
      patchRepo(path, { error: errorMessage(err), loading: false })
    }
  )
  const logPromise = withLog
    ? api.getLog(path, view.limit, view.graphScope).then(
        (log) => {
          if (logSeq[path] !== lSeq || !getRepo(path)) return
          patchRepo(path, { commits: log.commits, hasMore: log.hasMore })
          void loadAvatars(path, log.commits)
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
  const hasChanges = wipShown(view.state)
  const head = view.state.head.hash
  if (view.selection === null || (view.selection.kind === 'wip' && !hasChanges)) {
    if (hasChanges) selectWip(path, true)
    else if (head) void selectCommit(path, head, false, true)
    else patchRepo(path, { selection: null, details: null })
  }
}

export async function loadMore(path: string): Promise<void> {
  const view = getRepo(path)
  if (!view || !view.hasMore) return
  patchRepo(path, { limit: view.limit + repoSettings(path).commitLimit })
  await refreshRepo(path, { log: true })
}

// ---------------------------------------------------------------------------
// Selection & diffs

export function selectWip(path: string, keepFileView = false): void {
  if (!keepFileView && getRepo(path)?.fileView) patchRepo(path, { fileView: null })
  patchRepo(path, (r) => ({
    selection: { kind: 'wip' },
    details: null,
    diff: r.diff && r.diff.source.kind !== 'commit' ? r.diff : null
  }))
}

/** History of a file from HEAD, or (`rev`) from a commit of another branch. The open diff gives way to it. */
export function openFileHistory(path: string, file: string, rev: string | null = null): void {
  patchRepo(path, { fileView: { kind: 'history', path: file, rev }, diff: null, review: null })
}

/** History of a folder: the commits that changed anything inside it, from HEAD or from `rev`. */
export function openFolderHistory(path: string, folder: string, rev: string | null = null): void {
  patchRepo(path, { fileView: { kind: 'folder', path: folder, rev }, diff: null, review: null })
}

/** Blame of a file in the working tree (`rev` null) or as it was in a commit. */
export function openBlame(path: string, file: string, rev: string | null): void {
  patchRepo(path, { fileView: { kind: 'blame', path: file, rev }, diff: null, review: null })
}

/**
 * Blame of the file as it was before the commit that last changed `line` (in that commit's parent, under the name
 * the file had there), showing where the line was. Back returns to this blame, at this line.
 */
export function blameBefore(path: string, line: BlameLine): void {
  const view = getRepo(path)?.fileView
  if (!line.previous || view?.kind !== 'blame') return
  const here = { ...view, line: line.line, back: undefined }
  patchRepo(path, {
    fileView: {
      kind: 'blame',
      path: line.previous.path,
      rev: line.previous.hash,
      line: line.origLine,
      back: [...(view.back ?? []), here]
    }
  })
}

/** Back to the blame looked before (see `blameBefore`). */
export function fileViewBack(path: string): void {
  const back = getRepo(path)?.fileView?.back
  if (!back?.length) return
  patchRepo(path, { fileView: { ...back[back.length - 1], back: back.slice(0, -1) } })
}

export function closeFileView(path: string): void {
  patchRepo(path, { fileView: null })
}

/**
 * Leaves the file view for the graph, with that commit selected and in sight.
 * Older commits than the graph holds are loaded first (within reason).
 */
export async function showCommitInGraph(path: string, hash: string): Promise<void> {
  patchRepo(path, { fileView: null, diff: null, review: null })
  const loaded = () => getRepo(path)?.commits.some((c) => c.hash === hash) ?? false
  for (let round = 0; round < 10 && !loaded() && getRepo(path)?.hasMore; round++) await loadMore(path)
  if (!loaded()) toast('info', t('history.notInGraph'))
  await selectCommit(path, hash, true)
}

export async function selectCommit(path: string, hash: string, scroll = false, keepFileView = false): Promise<void> {
  const view = getRepo(path)
  if (!view) return
  // Picking something else leaves the file history or blame.
  if (!keepFileView && view.fileView) patchRepo(path, { fileView: null })
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

/** Selects a branch's tip; the graph then dims what is not in that branch's history. */
export function selectRef(path: string, ref: GitRef): void {
  void selectCommit(path, ref.hash, true)
  // The branch, not its tip now: after a pull or a commit it keeps covering the branch's new commits.
  patchRepo(path, { highlight: ref.type === 'tag' ? null : ref.fullName })
}

export function clearHighlight(path: string): void {
  if (getRepo(path)?.highlight) patchRepo(path, { highlight: null })
}

function setGraphScope(path: string, scope: GraphScope): void {
  writeGraphScope(path, scope)
  patchRepo(path, { graphScope: scope })
  void refreshRepo(path, { log: true })
}

/** Leaves a branch out of the graph (its commits stay if other branches have them). */
export function hideInGraph(path: string, ref: GitRef): void {
  const scope = getRepo(path)?.graphScope ?? { hidden: [], solo: null }
  setGraphScope(path, { hidden: [...new Set([...scope.hidden, ref.fullName])], solo: null })
}

export function showInGraph(path: string, ref: GitRef): void {
  const scope = getRepo(path)?.graphScope ?? { hidden: [], solo: null }
  setGraphScope(path, { hidden: scope.hidden.filter((r) => r !== ref.fullName), solo: scope.solo })
}

/** Shows only this branch (and what it comes from). */
export function soloInGraph(path: string, ref: GitRef): void {
  setGraphScope(path, { hidden: [], solo: ref.fullName })
}

export function showAllInGraph(path: string): void {
  setGraphScope(path, { hidden: [], solo: null })
}

function sameSource(a: DiffSource, b: DiffSource): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function openDiff(path: string, source: DiffSource): Promise<void> {
  patchRepo(path, { diff: { source, data: null }, fileView: null, review: null })
  await loadDiff(path, source)
}

async function loadDiff(path: string, source: DiffSource): Promise<void> {
  // Reloads of the same file can overlap (watcher + operation refresh); only the latest may land.
  const seq = (diffSeq[path] = (diffSeq[path] ?? 0) + 1)
  const isCurrent = (r: RepoView) => diffSeq[path] === seq && !!r.diff && sameSource(r.diff.source, source)
  try {
    const data = await api.getDiff(path, source, useStore.getState().diffFullFile)
    patchRepo(path, (r) => {
      if (!isCurrent(r)) return {}
      // Read again unchanged: the same object, so the lines picked in the diff stay picked.
      if (!r.diff?.error && sameDiff(r.diff?.data, data)) return {}
      return { diff: { source, data } }
    })
  } catch (err) {
    patchRepo(path, (r) => (isCurrent(r) ? { diff: { source, data: null, error: errorMessage(err) } } : {}))
  }
}

async function reloadDiff(path: string): Promise<void> {
  const diff = getRepo(path)?.diff
  if (diff) await loadDiff(path, diff.source)
}

/** Shows the whole file in diffs, or only the lines around each change; open diffs reload. */
export function setDiffFullFile(on: boolean): void {
  useStore.setState({ diffFullFile: on })
  try {
    localStorage.setItem(DIFF_FULL_FILE_KEY, on ? '1' : '0')
  } catch {
    // not critical: the next start shows only the changes
  }
  for (const path of Object.keys(useStore.getState().repos)) void reloadDiff(path)
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
 * Runs `fn` and records what it changed (refs, HEAD, the stash list, and the files in `paths`) so it can be undone.
 * `'changes'` copies every uncommitted change as git sees it just before (a stash or discard of them all): the
 * last refresh may not have seen them all yet. Errors propagate; nothing is recorded when nothing changed, nor when a
 * file in `paths` is too large to keep.
 */
async function recordUndo<T>(
  path: string,
  label: string,
  mode: RepoChange['mode'],
  fn: () => Promise<T>,
  paths: string[] | 'changes' = []
): Promise<T> {
  // A background fetch would bring its tags into what this action changed, and undoing it would delete them: one
  // under way ends first, and none starts until the action is recorded.
  recording.set(path, (recording.get(path) ?? 0) + 1)
  try {
    await backgroundFetches.idle(path)
    const before = await api.getSnapshot(path, paths).catch(() => null)
    const result = await fn()
    if (before?.tooLarge?.length) {
      // Without a copy of those files, undoing would lose them: better nothing to undo.
      const [name] = before.tooLarge
      toast('info', t('toast.undoTooLarge', { name: basename(name), count: before.tooLarge.length }))
      return result
    }
    const copied = paths === 'changes' ? Object.keys(before?.files ?? {}) : paths
    const after = before ? await api.getSnapshot(path, copied).catch(() => null) : null
    const change = before && after ? diffSnapshots(before, after, mode) : null
    if (change) patchRepo(path, (r) => pushEntry(r, { label, change }))
    return result
  } finally {
    const left = (recording.get(path) ?? 1) - 1
    if (left) recording.set(path, left)
    else recording.delete(path)
  }
}

/** Repositories with an action being recorded for undo, and how many. */
const recording = new Map<string, number>()

async function runOp(
  path: string,
  fn: () => Promise<unknown>,
  opts: {
    busy?: BusyKind
    success?: string
    log?: boolean
    /** `paths`: files it changes in the working tree or the index (a discard, a stash), copied to bring them back. */
    undo?: { label: string; mode?: RepoChange['mode']; paths?: string[] | 'changes' }
    /** Shown instead of git's message when the command fails. */
    errorText?: string
    /** Failures the caller handles itself (no error toast for them); `after` is the state they left. */
    quiet?: (err: unknown, after: RepoState | null) => boolean
  } = {}
): Promise<boolean> {
  if (opts.busy) patchRepo(path, { busy: opts.busy, progress: null })
  const before = getRepo(path)?.state?.operation ?? null
  try {
    // Busy marks network work: it starts once a background fetch of the repository is over.
    if (opts.busy) await backgroundFetches.idle(path)
    if (opts.undo) await recordUndo(path, opts.undo.label, opts.undo.mode ?? 'keep', fn, opts.undo.paths)
    else await fn()
    if (opts.success) toast('success', opts.success)
    return true
  } catch (err) {
    // A merge, rebase, cherry-pick or revert that stopped for conflicts has not failed: the banner takes over
    // (git's own message mentions commands the app does not offer).
    const after = await api.getState(path).catch(() => null)
    const stopped = stoppedOperation(before, after)
    if (stopped?.conflicts) toast('info', t('toast.stoppedForConflicts'))
    else if (opts.quiet?.(err, after)) {
      // the caller says what happened
    } else if (stopped) {
      // Stopped for something else: git's reason, without its hints about commands the app does not offer.
      const reason = stopReason(errorMessage(err))
      toast('error', reason ? t('toast.stoppedFor', { reason }) : errorMessage(err))
    } else toast('error', opts.errorText ?? errorMessage(err))
    // Show the banner and the conflicted files.
    if (stopped) selectWip(path)
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
  void loadPullRequests(path)
  void loadLfsLocks(path, false)
  return ok
}

/**
 * Background fetches running, per repository. Network operations wait for them: two fetches at once fail with
 * "cannot lock ref".
 */
const backgroundFetches = inFlight()

/** Quiet fetch used by auto-fetch: no prompts, no toasts; errors go to the status bar. */
export async function fetchInBackground(path: string): Promise<void> {
  const view = getRepo(path)
  if (!view?.state?.remotes.length || view.busy || recording.has(path)) return
  await backgroundFetches.run(path, async () => {
    patchRepo(path, { lastFetchAt: Date.now() })
    try {
      await api.fetch(path, true)
      patchRepo(path, { lastFetchError: null })
      await refreshRepo(path)
      void loadPullRequests(path)
      void loadLfsLocks(path, false)
    } catch (err) {
      patchRepo(path, { lastFetchError: errorMessage(err) })
    }
  })
}

/** Runs due background fetches for every open repository. */
export function autoFetchTick(): void {
  const { tabs, repos, settings } = useStore.getState()
  const now = Date.now()
  for (const tab of tabs) {
    const view = tab.path ? repos[tab.path] : undefined
    if (view && isFetchDue(view.lastFetchAt, now, settingsFor(settings, view.path).autoFetchMinutes)) {
      void fetchInBackground(view.path)
    }
  }
}

/** Tip of a local branch (or of a detached HEAD) as the store last saw it. */
function branchTip(path: string, branch: string | null): string | null {
  const state = getRepo(path)?.state
  if (!branch) return state?.head.hash ?? null
  return state?.refs.find((r) => r.type === 'head' && r.name === branch)?.hash ?? null
}

/** Names the branch that was pulled and says whether it moved. */
function pulledToast(path: string, branch: string | null, before: string | null): void {
  const moved = branchTip(path, branch) !== before
  toast(moved ? 'success' : 'info', t(moved ? 'toast.pulledInto' : 'toast.upToDate', { branch: branch ?? 'HEAD' }))
}

/** After HEAD moved, show where it is now (unless the user is looking at their uncommitted changes). */
function revealHead(path: string, hash: string): void {
  const view = getRepo(path)
  const status = view?.state?.status
  const dirty = !!status && status.staged.length + status.unstaged.length + status.conflicted.length > 0
  if (view?.selection?.kind === 'wip' && dirty) patchRepo(path, (r) => ({ scrollNonce: r.scrollNonce + 1 }))
  else void selectCommit(path, hash, true)
}

export async function pull(path: string, mode?: PullMode): Promise<boolean> {
  const current = repoSettings(path).pullMode
  const effective = mode ?? current
  if (mode && mode !== current) void saveSettingFor(path, 'pullMode', mode)
  const branch = headBranch(path)
  const before = branchTip(path, branch)
  const ok = await runPastChanges(path, () => api.pull(path, effective), {
    label: t('undo.pull'),
    busy: 'pull',
    ask: (block) => askOpWay(t('dlg.whatPull'), block)
  })
  if (ok) {
    pulledToast(path, branch, before)
    const head = getRepo(path)?.state?.head.hash
    if (head && head !== before) revealHead(path, head)
  }
  return ok
}

/** Fast-forwards a local branch that is not checked out, without switching to it. */
export async function pullBranch(path: string, ref: GitRef): Promise<boolean> {
  const ok = await runOp(path, () => api.pullBranch(path, ref.name), {
    busy: 'pull',
    undo: { label: t('undo.pull') }
  })
  if (ok) pulledToast(path, ref.name, ref.hash)
  return ok
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
  // git refuses when the remote branch has commits that are not here yet: offer to pull them first.
  let behind = false
  const ok = await runOp(path, () => api.push(path, { force: !!opts.force, branch: opts.branch, remote }), {
    busy: 'push',
    success: t('toast.pushed', { branch }),
    quiet: (err) => (behind = !opts.force && pushNeedsPull(errorMessage(err)))
  })
  if (ok || !behind) return ok
  // Pull brings the checked-out branch only.
  if (branch !== headBranch(path)) {
    toast('error', t('error.pushBehindOther', { branch }))
    return false
  }
  const again = await confirmDialog({
    title: t('dlg.pushBehindTitle'),
    message: t('dlg.pushBehind', { branch }),
    confirmText: t('dlg.pullAndPush')
  })
  if (!again || !(await pull(path))) return false
  return push(path, { branch: opts.branch })
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
  await runOp(path, () => api.stashSave(path, message), {
    undo: { label: t('undo.stash'), paths: 'changes' }
  })
}

/** Stashes only these files (both their staged and unstaged changes; a rename takes its old path along). */
export async function stashFiles(path: string, files: FileChange[]): Promise<void> {
  const paths = [...new Set(files.flatMap(changePaths))]
  await runOp(path, () => api.stashSave(path, null, paths), { undo: { label: t('undo.stash'), paths } })
}

/** Pops `stash`, or the most recent stash when none is given (toolbar Pop). */
export async function popStash(path: string, stash?: Stash): Promise<void> {
  const target = stash ?? getRepo(path)?.state?.stashes[0]
  if (!target) {
    toast('info', t('toast.noStashes'))
    return
  }
  await restoreStash(path, target, true)
}

export function applyStash(path: string, stash: Stash): Promise<boolean> {
  return restoreStash(path, stash, false)
}

/**
 * Applies (or pops) a stash. Its untracked files that already exist are left
 * as they are and git fails after applying the rest: that is said plainly
 * instead of git's file-by-file list.
 *
 * When files it changes have uncommitted changes, git refuses to apply it at all: the user can set those changes
 * aside in a stash of their own first. Where it clashes with the files, git leaves them with conflicts to resolve
 * and keeps the stash: that is said instead of git's report.
 */
async function restoreStash(path: string, stash: Stash, pop: boolean): Promise<boolean> {
  const inTheWay = await api.stashTrackedClashes(path, stash.index, stash.hash).catch(() => [])
  if (inTheWay.length) {
    const ok = await confirmDialog({
      title: t('dlg.stashClashTitle'),
      message:
        inTheWay.length === 1
          ? t('dlg.stashClashOne', { name: inTheWay[0] })
          : t('dlg.stashClashMany', { count: inTheWay.length }),
      confirmText: t('dlg.stashClashConfirm')
    })
    if (!ok) return false
    const aside = await runOp(path, () => api.stashSave(path, t('stash.setAside', { name: stash.message }), inTheWay))
    if (!aside) return false
    // The new stash comes first: the picked one moved down, find it by its hash.
    const moved = (await api.getState(path)).stashes.find((s) => s.hash === stash.hash)
    if (!moved) return false
    const done = await restoreStash(path, moved, pop)
    if (done) toast('info', t('toast.stashSetAside'))
    return done
  }
  const clashes = await api.stashUntrackedClashes(path, stash.index, stash.hash).catch(() => [])
  const restore = pop ? api.stashPop : api.stashApply
  const paths = await api.stashPaths(path, stash.index, stash.hash).catch(() => [])
  const label = t(pop ? 'undo.stashPop' : 'undo.stashApply', { name: stash.message })
  const hadConflicts = !!getRepo(path)?.state?.status.conflicted.length
  let clashed = false
  const ok = await runOp(path, () => restore(path, stash.index, stash.hash), {
    errorText: clashes.length ? t('error.stashUntrackedExist', { count: clashes.length }) : undefined,
    quiet: (_, after) => (clashed = !hadConflicts && !!after?.status.conflicted.length),
    undo: { label, paths }
  })
  if (clashed) {
    toast('info', t('toast.stashConflicts'))
    selectWip(path)
  }
  return ok
}

export async function dropStash(path: string, stash: Stash): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.stashDrop'),
    message: t('dlg.dropStash', { name: stash.message }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (ok) {
    await runOp(path, () => api.stashDrop(path, stash.index, stash.hash), {
      undo: { label: t('undo.stashDrop', { name: stash.message }) }
    })
  }
}

/** After a checkout, show the uncommitted changes that came along, or else where HEAD is now. */
function showAfterCheckout(path: string): void {
  const next = viewAfterCheckout(getRepo(path)?.state ?? null)
  if (next?.kind === 'wip') selectWip(path)
  else if (next) void selectCommit(path, next.hash, true)
}

/** What to do with uncommitted changes in the way of an operation. */
type ChangesWay = 'stash' | 'carry' | 'discard'

/**
 * Runs `op` (a checkout, merge, pull, rebase, cherry-pick or revert), recorded for undo as `label`. When uncommitted
 * changes are in its way (git changed nothing), `ask` says what to do with them: put them in a stash, take them along
 * (stashed, then popped once the operation is over), or put the files in the way back as the last commit has them.
 * Then it runs again, recorded with that as one change to undo. True when the operation ran.
 */
async function runPastChanges(
  path: string,
  op: () => Promise<ChangesBlock | null>,
  opts: { label: string; busy?: BusyKind; ask: (block: ChangesBlock) => Promise<ChangesWay | null> }
): Promise<boolean> {
  const { label, busy } = opts
  const first: { block: ChangesBlock | null } = { block: null }
  const ran = await runOp(path, async () => void (first.block = await op()), { busy, undo: { label } })
  const block = first.block
  if (!ran) return false
  if (!block) return true
  const way = await opts.ask(block)
  if (!way) return false
  const stashes = new Set(getRepo(path)?.state?.stashes.map((s) => s.hash))
  const aside =
    way === 'discard'
      ? {
          paths: [...block.changed, ...block.untracked],
          run: () => api.restoreFromHead(path, block.changed, block.untracked)
        }
      : { paths: 'changes' as const, run: () => api.stashSave(path, null) }
  const done = await runOp(
    path,
    async () => {
      // A failure is thrown once recorded: what was stashed or discarded stays undoable.
      const failure = await recordUndo(
        path,
        label,
        'keep',
        async () => {
          await aside.run()
          try {
            const still = await op()
            return still ? new Error(still.message) : null
          } catch (err) {
            return err
          }
        },
        aside.paths
      )
      if (failure) throw failure
    },
    { busy }
  )
  const stash = getRepo(path)?.state?.stashes.find((s) => !stashes.has(s.hash))
  if (way !== 'carry' || !stash) return done
  // Stopped for conflicts (or failed): the changes wait in the stash until it is over.
  if (!done) toast('info', t('toast.changesWaitInStash', { name: stash.message }))
  else await restoreStash(path, stash, true)
  return done
}

/**
 * Checks out with `checkout`; with uncommitted changes in the way, asks whether to stash them, take them along or
 * discard them (`runPastChanges`).
 */
async function switchTo(
  path: string,
  name: string,
  checkout: () => Promise<ChangesBlock | null>,
  busy?: BusyKind
): Promise<boolean> {
  const ok = await runPastChanges(path, checkout, {
    label: t('undo.checkout', { name }),
    busy,
    ask: (block) => askCheckoutWay(name, block)
  })
  if (ok) showAfterCheckout(path)
  return ok
}

/**
 * The choice for uncommitted changes in the way of an operation (`what` names it): stash them and bring them back
 * once it is done, or only stash them.
 */
async function askOpWay(what: string, block: ChangesBlock): Promise<ChangesWay | null> {
  const list = [...block.changed, ...block.untracked, ...block.folders.map((f) => f + '/')]
  const choice = await choiceDialog({
    title: t('dlg.checkoutBlockedTitle'),
    message: list.length ? t('dlg.opBlocked', { what, count: list.length }) : t('dlg.opBlockedAll', { what }),
    list: list.length ? list : undefined,
    note: [t('dlg.opBlockedCarry'), t('dlg.opBlockedStash')].join('\n'),
    choices: [
      { key: 'stash', label: t('dlg.opStash') },
      { key: 'carry', label: t('dlg.opCarry'), primary: true }
    ]
  })
  return choice as ChangesWay | null
}

/** The choice between stashing, taking along or discarding the changes in the way of checking out `name`. */
async function askCheckoutWay(name: string, block: ChangesBlock): Promise<ChangesWay | null> {
  const list = [...block.changed, ...block.untracked, ...block.folders.map((f) => f + '/')]
  // The untracked files of a folder are not copied to undo a discard: only stashing is offered for them.
  const discard = !block.folders.length
  const choice = await choiceDialog({
    title: t('dlg.checkoutBlockedTitle'),
    message: t('dlg.checkoutBlocked', { name, count: list.length }),
    list,
    note: [
      t('dlg.checkoutBlockedStash'),
      t('dlg.checkoutBlockedCarry', { name }),
      ...(discard ? [t('dlg.checkoutBlockedDiscard')] : [])
    ].join('\n'),
    choices: [
      ...(discard ? [{ key: 'discard', label: t('dlg.checkoutDiscard'), danger: true }] : []),
      { key: 'carry', label: t('dlg.checkoutCarry') },
      { key: 'stash', label: t('dlg.checkoutStash'), primary: true }
    ]
  })
  return choice as ChangesWay | null
}

export function checkoutRef(path: string, ref: GitRef): Promise<boolean> {
  const checkout =
    ref.type === 'head'
      ? () => api.checkout(path, ref.name)
      : ref.type === 'remote'
        ? () => api.checkoutRemote(path, ref.name)
        : () => api.checkoutDetached(path, ref.name)
  return switchTo(path, ref.name, checkout)
}

export function checkoutCommit(path: string, hash: string): Promise<boolean> {
  return switchTo(path, hash.slice(0, 7), () => api.checkoutDetached(path, hash))
}

export function mergeRef(path: string, name: string): Promise<boolean> {
  return runPastChanges(path, () => api.merge(path, name), {
    label: t('undo.merge', { name }),
    ask: (block) => askOpWay(t('dlg.whatMerge', { name }), block)
  })
}

/** Checks out `into` and merges `from` into it, once the user agreed to leave the current branch. */
export async function checkoutAndMerge(path: string, into: string, from: string): Promise<boolean> {
  const state = getRepo(path)?.state
  const changes = state ? state.status.staged.length + state.status.unstaged.length : 0
  const ok = await confirmDialog({
    title: t('menu.checkoutMerge', { into, from }),
    message:
      t('dlg.checkoutMerge', { current: state?.head.branch ?? 'HEAD', into, from }) +
      (changes ? '\n\n' + t('dlg.checkoutMergeChanges', { into }) : ''),
    confirmText: t('dlg.checkoutMergeConfirm')
  })
  if (!ok) return false
  return runOp(
    path,
    async () => {
      const block = (await api.checkout(path, into)) ?? (await api.merge(path, from))
      if (block) throw new Error(block.message)
    },
    { undo: { label: t('undo.merge', { name: from }) } }
  )
}

export function rebaseOnto(path: string, name: string): Promise<boolean> {
  return runPastChanges(path, () => api.rebase(path, name), {
    label: t('undo.rebase', { name }),
    ask: (block) => askOpWay(t('dlg.whatRebase', { name }), block)
  })
}

/** Opens the interactive rebase dialog for the commits after `base`. */
export async function openInteractiveRebase(path: string, base: string): Promise<void> {
  const operation = getRepo(path)?.state?.operation
  if (operation) {
    toast('error', t('error.operationInProgress', { operation: t(`op.${operation}`) }))
    return
  }
  try {
    const { commits, script } = await api.getRebaseCommits(path, base)
    useStore.setState({ rebase: { path, base, commits, script } })
  } catch (err) {
    toast('error', errorMessage(err))
  }
}

export function closeInteractiveRebase(): void {
  useStore.setState({ rebase: null })
}

/** Runs the rebase; when it stops for a conflict, the operation banner takes over. */
/**
 * Runs the rebase. The dialog closes once it finished, or stopped part-way
 * (the operation banner takes over); when it was refused before starting
 * (uncommitted changes, a stale list...), it stays open with what was typed.
 */
export async function startInteractiveRebase(
  path: string,
  base: string,
  items: RebaseItem[]
): Promise<'done' | 'stopped' | 'refused'> {
  // A rebase (or another operation) already under way is a refusal, not this rebase stopping.
  const before = (await api.getState(path).catch(() => null))?.operation ?? null
  try {
    await recordUndo(path, t('undo.interactiveRebase'), 'keep', () => api.interactiveRebase(path, base, items))
    closeInteractiveRebase()
    // git stops without an error at a commit to edit: say so and show the banner, not "rebased".
    if ((await api.getState(path).catch(() => null))?.editing) {
      toast('info', t('toast.rebaseEditStop'))
      selectWip(path)
      return 'stopped'
    }
    toast('success', t('toast.rebased'))
    return 'done'
  } catch (err) {
    const stopped = stoppedOperation(before, await api.getState(path).catch(() => null))
    if (stopped?.operation === 'rebase') {
      // git's own output here is long and mentions commands the app does not offer: only its reason is kept.
      const reason = stopReason(errorMessage(err))
      if (stopped.conflicts) toast('info', t('toast.stoppedForConflicts'))
      else if (reason) toast('error', t('toast.rebaseStoppedFor', { reason }))
      else toast('info', t('toast.rebaseStopped'))
      closeInteractiveRebase()
      // Show the banner and the conflicted files.
      selectWip(path)
      return 'stopped'
    }
    toast('error', errorMessage(err))
    return 'refused'
  } finally {
    await refreshRepo(path)
  }
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

/**
 * Local branches whose remote branch is gone (deleted there), apart from the one checked out. A branch never pushed
 * has no remote branch to lose, so it is never among them.
 */
export function goneBranches(path: string): GitRef[] {
  return (getRepo(path)?.state?.refs ?? []).filter((r) => r.type === 'head' && r.upstreamGone && !r.isHead)
}

/**
 * Deletes the branches picked among those whose remote branch is gone. A branch with commits that no other branch,
 * remote branch or tag has comes unchecked (a squash merge leaves them so): deleting it would lose them. All of
 * them come back with one undo.
 */
export async function deleteGoneBranches(path: string): Promise<void> {
  const gone = goneBranches(path)
  if (!gone.length) return
  const own = await api
    .commitsOnlyOn(
      path,
      gone.map((r) => r.name)
    )
    .catch(() => null)
  const values = await formDialog({
    title: t('dlg.deleteGoneTitle'),
    message: t('dlg.deleteGone'),
    fields: [
      {
        key: 'branches',
        label: t('dlg.deleteGoneBranches', { count: gone.length }),
        type: 'checklist',
        value: gone
          .filter((r) => own?.[r.name] === 0)
          .map((r) => r.name)
          .join('\n'),
        options: gone.map((r) => ({
          value: r.name,
          label: r.name,
          note: !own
            ? undefined
            : own[r.name]
              ? t('dlg.deleteGoneOwn', { count: own[r.name] })
              : t('dlg.deleteGoneSafe')
        }))
      }
    ],
    confirmText: t('dlg.delete'),
    danger: true
  })
  const names = values?.branches?.split('\n').filter(Boolean) ?? []
  if (!names.length) return
  await runOp(
    path,
    async () => {
      for (const name of names) await api.deleteBranch(path, name, true)
    },
    {
      undo: { label: t('undo.deleteBranches', { count: names.length }) },
      success: t('toast.deletedBranches', { count: names.length })
    }
  )
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
  const name = hash.slice(0, 7)
  return runPastChanges(path, () => api.cherryPick(path, hash), {
    label: t('undo.cherryPick', { name }),
    ask: (block) => askOpWay(t('dlg.whatCherryPick', { name }), block)
  })
}

export function revertCommit(path: string, hash: string): Promise<boolean> {
  const name = hash.slice(0, 7)
  return runPastChanges(path, () => api.revert(path, hash), {
    label: t('undo.revert', { name }),
    ask: (block) => askOpWay(t('dlg.whatRevert', { name }), block)
  })
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
  // A hard reset drops the uncommitted changes of tracked files (new files stay): copied, to bring them back.
  const status = getRepo(path)?.state?.status
  const dropped =
    mode === 'hard'
      ? [
          ...new Set(
            [...(status?.staged ?? []), ...(status?.unstaged ?? [])]
              .filter((f) => f.status !== '?')
              .flatMap(changePaths)
          )
        ]
      : []
  await runOp(path, () => api.reset(path, hash, mode), {
    undo: { label: t('undo.reset', { name: hash.slice(0, 7) }), mode: undoModeForReset(mode), paths: dropped }
  })
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

/** Discards changes after a confirmation that names the file, or says how many. True when they were discarded. */
export async function discardFiles(path: string, files: FileChange[]): Promise<boolean> {
  const summary = discardSummary(files)
  const single = summary.name !== null
  let message =
    summary.name !== null
      ? t('dlg.discardFile', { name: summary.name })
      : t('dlg.discardFiles', { count: summary.count })
  if (summary.untracked) {
    message +=
      '\n\n' + (single ? t('dlg.discardUntracked') : t('dlg.discardUntrackedCount', { count: summary.untracked }))
  }
  const ok = await confirmDialog({ title: t('menu.discard'), message, confirmText: t('menu.discard'), danger: true })
  if (!ok) return false
  // `git restore` does not move submodules: those go back to the recorded commit instead.
  const subs = (getRepo(path)?.submodules ?? []).filter((s) => files.some((f) => f.path === s.path))
  const plain = files.filter((f) => !subs.some((s) => s.path === f.path))
  const tracked = plain.filter((f) => f.status !== '?').map((f) => f.path)
  const untracked = plain.filter((f) => f.status === '?').map((f) => f.path)
  const undo = {
    label: single ? t('undo.discard', { name: summary.name! }) : t('undo.discardFiles', { count: plain.length }),
    paths: [...tracked, ...untracked]
  }
  const discarded = plain.length
    ? await runOp(path, () => api.discard(path, tracked, untracked), { log: false, undo })
    : true
  const moved = subs.filter((s) => s.state === 'outOfSync')
  if (moved.length) await updateSubmodules(path, moved)
  const inside = subs.filter((s) => s.state !== 'outOfSync' && s.dirty)
  if (inside.length) toast('info', t('sub.discardInside', { path: inside.map((s) => s.path).join(', ') }))
  return discarded
}

export async function discardAll(path: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.discardAll'),
    message: t('dlg.discardAll'),
    confirmText: t('menu.discardAll'),
    danger: true
  })
  if (!ok) return
  // In the middle of a merge or rebase, discarding everything ends it: that is not brought back.
  const undo = getRepo(path)?.state?.operation ? undefined : { label: t('undo.discardAll'), paths: 'changes' as const }
  await runOp(path, () => api.discardAll(path), { log: false, undo })
}

/** The paths a change touches: a rename's old one too. */
function changePaths(file: FileChange): string[] {
  return file.origPath ? [file.origPath, file.path] : [file.path]
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
  const undo =
    mode === 'discard' ? { label: t('undo.discardHunk', { name: basename(diff.path) }), paths: [diff.path] } : undefined
  patchRepo(path, { applying: true })
  try {
    await runOp(path, () => api.applyPatch(path, patch, opts), { log: false, undo })
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
  if (amend && draftUntouched(view)) {
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
  const rewritesPushed = !!view.state && amendsPushedCommit(amend, view.state)
  const ok = await runOp(path, () => api.commit(path, message, amend), {
    undo: { label: t(amend ? 'undo.amend' : 'undo.commit', { name: summary.trim() }), mode: 'soft' }
  })
  if (ok) {
    // The next commit starts from the template again.
    const template = getRepo(path)?.template
    updateDraft(path, { summary: template?.summary ?? '', body: template?.body ?? '', amend: false })
    patchRepo(path, { diff: null })
    const state = getRepo(path)?.state
    if (repoSettings(path).pushAfterCommit && state && pushAfterCommitTarget(state.head, state.remotes)) {
      // Never force-push on its own: say what is needed instead.
      if (rewritesPushed) toast('info', t('toast.amendNotPushed'))
      else await push(path)
    }
  }
  return ok
}

// ---------------------------------------------------------------------------
// Conflicts

/** Saves a resolved conflict and marks the file resolved. */
export async function resolveWithContent(
  path: string,
  file: string,
  content: string,
  original: string
): Promise<boolean> {
  const ok = await runOp(path, () => api.resolveConflictFile(path, file, content, original), {
    log: false,
    success: t('toast.resolved', { name: file })
  })
  if (ok) closeResolved(path, file)
  return ok
}

/** Closes the view of a file just resolved; another file opened meanwhile stays open. */
function closeResolved(path: string, file: string): void {
  if (getRepo(path)?.diff?.source.path === file) closeDiff(path)
}

/** Resolves a conflict with one side of the whole file (or its deletion), after asking when that loses edits. */
export async function resolveWithSide(path: string, file: string, side: 'ours' | 'theirs'): Promise<boolean> {
  const edited = await api.conflictFileEdited(path, file).catch(() => true)
  if (
    edited &&
    !(await confirmDialog({
      title: t(side === 'ours' ? 'conflict.takeCurrent' : 'conflict.takeIncoming'),
      message: t('dlg.takeSideLosesEdits', { name: file }),
      confirmText: t(side === 'ours' ? 'conflict.takeCurrent' : 'conflict.takeIncoming'),
      danger: true
    }))
  ) {
    return false
  }
  const ok = await runOp(path, () => api.resolveConflictWith(path, file, side), {
    log: false,
    success: t('toast.resolved', { name: file })
  })
  if (ok) closeResolved(path, file)
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
    // The repository moved on: this entry can never apply again, so drop it.
    // Other failures (local changes in the way, an operation in progress) may pass later.
    const stale = isStaleUndoError(errorMessage(err))
    if (stale) {
      patchRepo(path, (r) =>
        direction === 'undo' ? { undo: r.undo.filter((e) => e !== entry) } : { redo: r.redo.filter((e) => e !== entry) }
      )
    }
    toast('error', stale ? t(staleHistoryKey(direction)) : errorMessage(err))
  }
}

// One undo or redo at a time per repository: a press while one is being applied is ignored,
// or both would start from the same entry.
const historyRuns = inFlight()

/**
 * Applies the next undo or redo, then reads the repository again. The refresh comes after the run: Redo is there to
 * press as soon as an undo is applied, and a press then must not be ignored.
 */
async function runHistory(path: string, direction: 'undo' | 'redo'): Promise<void> {
  const run = historyRuns.run(path, () => applyHistory(path, direction))
  if (!run) return
  await run
  await refreshRepo(path)
}

export function undo(path: string): Promise<void> {
  return runHistory(path, 'undo')
}

export function redo(path: string): Promise<void> {
  return runHistory(path, 'redo')
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
  if (name && url && (await runOp(path, () => api.addRemote(path, name, url)))) void loadPullRequests(path)
}

export async function removeRemote(path: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('menu.removeRemote', { name }),
    message: t('dlg.removeRemote', { name }),
    confirmText: t('dlg.delete'),
    danger: true
  })
  if (ok && (await runOp(path, () => api.removeRemote(path, name)))) void loadPullRequests(path)
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

/** Opens a file at a line, or the repository, in the editor from Settings; without one, with the system's app. */
export function openInEditor(repo: string, file: string | null, line?: number): void {
  if (!repoSettings(repo).editor.trim()) {
    if (file) openFile(repo, file)
    else void api.openPath(repo).catch((err) => toast('error', errorMessage(err)))
    return
  }
  api.openInEditor(repo, file, line).catch((err) => toast('error', errorMessage(err)))
}

function toolError(err: unknown): void {
  toast('error', errorMessage(err) === 'NO_DIFF_TOOL' ? t('tools.noDiffTool') : errorMessage(err))
}

export function openInDiffTool(repo: string, source: DiffSource): void {
  api.openDiffTool(repo, source).catch(toolError)
}

export function openInMergeTool(repo: string, file: string): void {
  api.openMergeTool(repo, file).catch(toolError)
}

/** Windows: adds the `leviathan` command to the user's PATH, after saying so. */
export async function installCommandLine(): Promise<void> {
  const ok = await confirmDialog({
    title: t('tools.installCommand'),
    message: t('dlg.installCommand'),
    confirmText: t('tools.installCommand')
  })
  if (!ok) return
  try {
    const result = await api.installCommandLine()
    toast('success', t(result === 'added' ? 'toast.commandAdded' : 'toast.commandPresent'))
  } catch (err) {
    toast('error', errorMessage(err))
  }
}

/** A folder given on the command line (`leviathan .`), at start or while the app runs. */
export async function openFromCommandLine(folder: string): Promise<void> {
  // Into the welcome tab on screen, if that is what is showing.
  const { tabs, activeTab } = useStore.getState()
  const welcome = tabs.find((tab) => tab.id === activeTab && tab.path === null)
  try {
    await openRepository(folder, welcome?.id)
  } catch (err) {
    toast('error', errorMessage(err))
  }
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

// ---------------------------------------------------------------------------
// Git LFS

const lfsSeq: Record<string, number> = {}
const lfsInfoSeq: Record<string, number> = {}
const lfsKeys: Record<string, string> = {}

export const LFS_DOWNLOAD_URL = 'https://git-lfs.com'

/** Reads the LFS patterns again when they may have changed (another commit, an edited attributes file). */
function followLfs(path: string, state: RepoState): void {
  const key = lfsInfoKey(state)
  // A repository opened again starts without LFS info.
  if (lfsKeys[path] === key && !attributesChanged(state) && getRepo(path)?.lfs) return
  lfsKeys[path] = key
  void loadLfsInfo(path)
}

export async function loadLfsInfo(path: string): Promise<void> {
  // Two quick checkouts: the patterns of the first must not land after those of the second.
  const seq = (lfsInfoSeq[path] = (lfsInfoSeq[path] ?? 0) + 1)
  try {
    const info = await api.getLfsInfo(path)
    const before = getRepo(path)?.lfs
    if (lfsInfoSeq[path] !== seq || !getRepo(path)) return
    patchRepo(path, (r) => ({
      lfs: {
        locks: [],
        verified: false,
        locksUnsupported: false,
        locksError: null,
        locksLoading: false,
        ...r.lfs,
        info
      }
    }))
    // Locks need git-lfs: load them once the repository uses LFS and git-lfs is there (it may come later).
    if (info.used && info.version && !(before?.info.used && before.info.version)) void loadLfsLocks(path, false)
    void askToInstallGitLfs(path)
  } catch {
    // not critical: the LFS section and badges stay hidden
  }
}

const LFS_RECHECK_MS = 10_000
let lastLfsRecheck = 0
let recheckLater: ReturnType<typeof setTimeout> | undefined

/**
 * Back in the window: git-lfs may have been installed by hand meanwhile. Repositories that miss it read their LFS
 * info again (which loads their locks once it is there), at most every few seconds; back sooner, once the wait is over.
 */
export function recheckGitLfs(now = Date.now()): void {
  const wait = lastLfsRecheck + LFS_RECHECK_MS - now
  if (wait > 0) {
    recheckLater ??= setTimeout(() => recheckGitLfs(now + wait), wait)
    return
  }
  clearTimeout(recheckLater)
  recheckLater = undefined
  lastLfsRecheck = now
  for (const [path, view] of Object.entries(useStore.getState().repos)) {
    if (view.lfs?.info.used && !view.lfs.info.version) void loadLfsInfo(path)
  }
}

// Repositories already asked about installing git-lfs in this session, and whether a question is on screen.
const lfsAsked = new Set<string>()
let lfsAsking = false

/**
 * Offers to install git-lfs when the repository showing uses LFS and git-lfs is missing: once per repository
 * per session, one question at a time, never during an install.
 */
export async function askToInstallGitLfs(path: string): Promise<void> {
  const { activeTab, tabs, lfsOffer, lfsInstalling, whatsNewOpen } = useStore.getState()
  const info = getRepo(path)?.lfs?.info
  const showing = tabs.find((tab) => tab.id === activeTab)?.path === path
  if (!showing || !info?.used || info.version || !lfsOffer || lfsInstalling || lfsAsking || lfsAsked.has(path)) {
    return
  }
  // Not on top of "What's new": asked once it is closed.
  if (whatsNewOpen) return
  lfsAsked.add(path)
  lfsAsking = true
  const { method, command } = lfsOffer
  const installs = canInstall(lfsOffer)
  let ok: boolean
  try {
    ok = await confirmDialog({
      title: t('lfs.missingTitle'),
      message: `${t('dlg.lfsMissing', { repo: repoName(path) })}\n\n${t(`dlg.lfsHow.${method}`, { command: command ?? '' })}`,
      confirmText: t(installs ? 'lfs.installNow' : method === 'command' ? 'lfs.copyCommand' : 'lfs.install')
    })
  } finally {
    lfsAsking = false
  }
  if (!ok) return
  if (installs) await installGitLfs(path)
  else if (method === 'command') await copyText(command ?? '', t('toast.copied'))
  else openExternal(LFS_DOWNLOAD_URL)
}

useStore.subscribe((s, before) => {
  if (!before.whatsNewOpen || s.whatsNewOpen) return
  const path = s.tabs.find((tab) => tab.id === s.activeTab)?.path
  if (path) void askToInstallGitLfs(path)
})

/** Loads the locks from the LFS server; `interactive` may ask for credentials. */
export async function loadLfsLocks(path: string, interactive: boolean): Promise<void> {
  const view = getRepo(path)
  if (!view?.lfs?.info.used || !view.lfs.info.version || !view.state?.remotes.length) return
  const seq = (lfsSeq[path] = (lfsSeq[path] ?? 0) + 1)
  const patchLfs = (patch: Partial<LfsView>) => patchRepo(path, (r) => (r.lfs ? { lfs: { ...r.lfs, ...patch } } : {}))
  patchLfs({ locksLoading: true })
  try {
    const { locks, verified, unsupported } = await api.getLfsLocks(path, !interactive)
    if (lfsSeq[path] === seq) {
      patchLfs({ locks, verified, locksUnsupported: !!unsupported, locksError: null, locksLoading: false })
    }
  } catch (err) {
    if (lfsSeq[path] === seq) patchLfs({ locksError: errorMessage(err), locksLoading: false })
  }
}

export async function lockFiles(path: string, files: string[]): Promise<void> {
  let locked = 0
  try {
    for (const file of files) {
      await api.lfsLock(path, file)
      locked++
    }
    toast(
      'success',
      files.length === 1 ? t('toast.locked', { path: files[0] }) : t('toast.lockedCount', { count: locked })
    )
  } catch (err) {
    toast('error', errorMessage(err))
  } finally {
    await loadLfsLocks(path, true)
  }
}

/** Releases a lock; someone else's only after confirming that it is forced open. */
export async function unlockFile(path: string, lock: LfsLock): Promise<void> {
  const forceIt = (message: string) =>
    confirmDialog({ title: t('lfs.forceUnlock'), message, confirmText: t('lfs.forceUnlock'), danger: true })
  let force = false
  if (lock.mine === false) {
    if (!(await forceIt(t('dlg.forceUnlock', { path: lock.path, owner: lock.owner })))) return
    force = true
  }
  try {
    try {
      await api.lfsUnlock(path, lock, force)
    } catch (err) {
      // The server could not tell whose lock it is: it may be someone else's.
      if (force || lock.mine !== null) throw err
      const message = t('dlg.forceUnlockUnknown', { path: lock.path, owner: lock.owner, error: errorMessage(err) })
      if (!(await forceIt(message))) return
      await api.lfsUnlock(path, lock, true)
    }
    toast('success', t('toast.unlocked', { path: lock.path }))
  } catch (err) {
    toast('error', errorMessage(err))
  } finally {
    await loadLfsLocks(path, true)
  }
}

/** How this computer can get git-lfs: asked once, for the question and the LFS section's button. */
export async function loadLfsOffer(): Promise<void> {
  const lfsOffer = await api.getLfsInstallOffer().catch(() => null)
  useStore.setState({ lfsOffer })
}

/**
 * Installs git-lfs (its progress on `path`), then sets `path` up (its real files replace the pointers) and reads
 * the LFS info of every open repository again: they all use the same git-lfs.
 */
export async function installGitLfs(path: string): Promise<boolean> {
  if (useStore.getState().lfsInstalling) return false
  // A pull or push under way (accepted while it started): the install would take its place on screen.
  if (getRepo(path)?.busy) {
    toast('info', t('toast.lfsWaitBusy'))
    return false
  }
  useStore.setState({ lfsInstalling: true })
  patchRepo(path, { busy: 'lfs', progress: null })
  try {
    const version = await api.installGitLfs(path)
    toast('success', t('toast.lfsInstalled', { version }))
  } catch (err) {
    // The app may have learnt it cannot install it here (Linux without a password prompt): then, the command.
    await loadLfsOffer()
    const offer = useStore.getState().lfsOffer
    if (offer?.method === 'command') void showLfsCommand(offer.command ?? '')
    else {
      // The message goes on with a sentence of its own.
      const error = errorMessage(err).replace(/\.+$/, '')
      toast('error', t('toast.lfsInstallFailed', { error, link: t('lfs.install') }))
    }
    return false
  } finally {
    patchRepo(path, { busy: null, progress: null })
    useStore.setState({ lfsInstalling: false })
  }
  await runLfsSetup(path, false)
  await Promise.all(Object.keys(useStore.getState().repos).map((repo) => loadLfsInfo(repo)))
  return true
}

/** Sets git-lfs up for a repository; hooks of another tool are left as they are, with git-lfs's lines to add to them. */
async function runLfsSetup(path: string, log: boolean): Promise<void> {
  let hooksToMerge: string | null = null
  const ok = await runOp(
    path,
    async () => {
      ;({ hooksToMerge } = await api.setupLfs(path))
    },
    { busy: 'lfs', log }
  )
  if (!ok) return
  if (hooksToMerge) void showHooksToMerge(hooksToMerge)
  else toast('success', t('toast.lfsReady'))
}

/** Says that hooks of another tool need git-lfs's lines, and copies its instructions. */
async function showHooksToMerge(instructions: string): Promise<void> {
  const copy = await confirmDialog({
    title: t('lfs.hooksTitle'),
    message: t('dlg.lfsHooks'),
    confirmText: t('lfs.copyHooks')
  })
  if (copy) await copyText(instructions, t('toast.copied'))
}

/** Copies the command that installs git-lfs on this system, where the app cannot run it itself. */
export async function copyLfsCommand(): Promise<void> {
  const command = useStore.getState().lfsOffer?.command
  if (command) await copyText(command, t('toast.copied'))
}

/** The command that installs git-lfs here, to copy into a terminal. */
async function showLfsCommand(command: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('lfs.missingTitle'),
    message: t('dlg.lfsHow.command', { command }),
    confirmText: t('lfs.copyCommand')
  })
  if (ok) await copyText(command, t('toast.copied'))
}

/** Asks for a pattern (e.g. `*.psd`) and sends matching files through LFS from now on. */
export async function trackLfsPattern(path: string, pattern = ''): Promise<void> {
  const values = await formDialog({
    title: t('lfs.track'),
    message: t('dlg.lfsTrack'),
    confirmText: t('lfs.trackBtn'),
    fields: [
      { key: 'pattern', label: t('lfs.pattern'), value: pattern, placeholder: '*.psd' },
      {
        key: 'lockable',
        label: t('lfs.lockable'),
        type: 'select',
        value: 'no',
        options: [
          { value: 'no', label: t('lfs.lockableNo') },
          { value: 'yes', label: t('lfs.lockableYes') }
        ]
      }
    ]
  })
  const value = values?.pattern.trim()
  if (!values || !value) return
  if (await runOp(path, () => api.lfsTrack(path, value, values.lockable === 'yes'), { log: false })) {
    toast('success', t('toast.lfsTracked', { pattern: value }))
  }
  await loadLfsInfo(path)
}

export async function makeLockable(path: string, pattern: LfsPattern): Promise<void> {
  const ok = await confirmDialog({
    title: t('lfs.makeLockable'),
    message: t('dlg.makeLockable', { pattern: patternLabel(pattern) }),
    confirmText: t('lfs.makeLockable')
  })
  if (!ok) return
  await runOp(path, () => api.lfsTrack(path, pattern.pattern, true), { log: false })
  await loadLfsInfo(path)
}

export async function untrackLfsPattern(path: string, pattern: LfsPattern): Promise<void> {
  const ok = await confirmDialog({
    title: t('lfs.untrack'),
    message: t('dlg.lfsUntrack', { pattern: patternLabel(pattern) }),
    confirmText: t('lfs.untrack')
  })
  if (!ok) return
  await runOp(path, () => api.lfsUntrack(path, pattern), { log: false })
  await loadLfsInfo(path)
}

/** Sends staged files that are too big through LFS before they get committed. */
export async function moveToLfs(path: string, files: string[]): Promise<void> {
  await runOp(path, () => api.lfsMoveFiles(path, files), { log: false, success: t('toast.lfsMoved') })
  await loadLfsInfo(path)
}

/** Stages again through LFS files that were staged with their whole content. */
export async function restageLfs(path: string, files: string[]): Promise<void> {
  await runOp(path, () => api.lfsRestage(path, files), { log: false, success: t('toast.lfsMoved') })
}

/** `git lfs install`, then downloads the repository's LFS files. */
export async function setupLfs(path: string): Promise<void> {
  // It changes the user's own Git configuration, not just this repository: say so first.
  const ok = await confirmDialog({ title: t('lfs.setup'), message: t('dlg.lfsSetup'), confirmText: t('lfs.setup') })
  if (!ok) return
  await runLfsSetup(path, true)
  await loadLfsInfo(path)
}

// ---------------------------------------------------------------------------
// Submodules

const subSeq: Record<string, number> = {}

export async function loadSubmodules(path: string): Promise<void> {
  const seq = (subSeq[path] = (subSeq[path] ?? 0) + 1)
  try {
    const submodules = await api.getSubmodules(path)
    if (subSeq[path] === seq && getRepo(path)) patchRepo(path, { submodules })
  } catch {
    // not critical: the section keeps what it showed
  }
}

/** Initializes and checks out submodules (all of them when `subs` is null) at the commits this branch records. */
export async function updateSubmodules(path: string, subs: Submodule[] | null): Promise<void> {
  await runOp(path, () => api.updateSubmodules(path, subs ? subs.map((s) => s.path) : null), {
    busy: 'submodules',
    success: t('toast.submodulesUpdated'),
    log: false
  })
  await loadSubmodules(path)
}

export async function openSubmodule(path: string, sub: Submodule): Promise<void> {
  if (sub.state === 'uninitialized') {
    toast('info', t('sub.notInitialized'))
    return
  }
  try {
    await openRepository(joinPath(path, sub.path))
  } catch (err) {
    toast('error', errorMessage(err))
  }
}

export function openSubmoduleFolder(path: string, sub: Submodule): void {
  api.openPath(joinPath(path, sub.path)).catch((err) => toast('error', errorMessage(err)))
}

// ---------------------------------------------------------------------------
// What's new

export function openWhatsNew(): void {
  useStore.setState({ whatsNewOpen: true })
}

/** Notes of every published release from GitHub; throws when it cannot be reached (the app then shows its own). */
export function loadReleaseNotes(): Promise<ReleaseNote[]> {
  return api.getReleaseNotes()
}
