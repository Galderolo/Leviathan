import { lstatSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import {
  API_METHODS,
  IPC_INVOKE,
  IPC_PROGRESS,
  IPC_REPO_CHANGED,
  IPC_UPDATE,
  IPC_OPEN_FOLDER,
  type LeviathanInvokeApi,
  type IpcResult
} from '../shared/api'
import * as accounts from './accounts'
import { answerAskpass, askpassScripts } from './askpass'
import { installCommandLine, takeLaunchFolders } from './cli'
import * as lfs from './git/lfs'
import * as repo from './git/repository'
import * as submodules from './git/submodules'
import { loadSettings, saveSettings } from './settings'
import { openAction } from './shell'
import { generateKey, listKeys } from './ssh'
import { watchRepo, unwatchRepo } from './watcher'
import { getUpdater, initUpdates } from './autoUpdate'
import * as tools from './tools'
import { fetchReleaseNotes } from './releaseNotes'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function progress(path: string) {
  return (line: string) => broadcast(IPC_PROGRESS, { repo: path, line })
}

const handlers: LeviathanInvokeApi = {
  getSettings: async () => loadSettings(),
  saveSettings: async (patch) => saveSettings(patch),
  pickFolder: async (title) => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  gitVersion: () => repo.gitVersion(),
  appVersion: async () => app.getVersion(),
  getUpdateState: async () => getUpdater().state(),
  checkForUpdates: () => getUpdater().check(),
  downloadUpdate: () => getUpdater().download(),
  installUpdate: async () => getUpdater().install(),
  getReleaseNotes: () => fetchReleaseNotes(),

  openRepo: (path) => repo.openRepo(path),
  initRepo: (path, branch) => repo.initRepo(path, branch),
  cloneRepo: async (url, dest, accountId, recurseSubmodules) => {
    const args = accountId ? accounts.cloneArgsFor(accountId) : []
    const path = await repo.cloneRepo(url, dest, progress(dest), args)
    // Bound first, so private submodules on the same host are fetched with that account too.
    if (accountId) await accounts.setRepoAccount(path, accountId)
    const submoduleError = recurseSubmodules ? await submodules.initSubmodules(path, progress(dest)) : null
    return { path, submoduleError }
  },
  watchRepo: async (path) => watchRepo(path, (e) => broadcast(IPC_REPO_CHANGED, e)),
  unwatchRepo: async (path) => unwatchRepo(path),

  getState: (path) => repo.getState(path),
  getLog: (path, limit, scope) => repo.getLog(path, limit, scope),
  getCommitDetails: (path, hash) => repo.getCommitDetails(path, hash),
  getDiff: (path, source, fullFile) => repo.getDiff(path, source, fullFile === true),
  getSnapshot: (path) => repo.getSnapshot(path),
  // A limit that is not a whole number falls back to the first page there.
  getFileHistory: (path, file, rev, limit) => repo.getFileHistory(path, file, rev, limit),
  getFolderHistory: (path, folder, rev, limit) => repo.getFolderHistory(path, folder, rev, limit),
  getBlame: (path, file, rev) => repo.getBlame(path, file, rev),
  readWorkingFile: (path, file) => repo.readWorkingFile(path, file),
  resolveConflictFile: (path, file, content, original) => repo.resolveConflictFile(path, file, content, original),
  resolveConflictWith: (path, file, side) => repo.resolveConflictWith(path, file, side),
  conflictFileEdited: (path, file) => repo.conflictFileEdited(path, file),
  applyChange: (path, change) => repo.applyChange(path, change),
  getRebaseCommits: (path, base) => repo.getRebaseCommits(path, base),
  interactiveRebase: (path, base, items) => repo.interactiveRebase(path, base, items),

  stage: (path, paths) => repo.stage(path, paths),
  stageAll: (path) => repo.stageAll(path),
  unstage: (path, paths) => repo.unstage(path, paths),
  unstageAll: (path) => repo.unstageAll(path),
  discard: (path, paths, untracked) => repo.discard(path, paths, untracked),
  discardAll: (path) => repo.discardAll(path),
  applyPatch: (path, patch, opts) => repo.applyPatch(path, patch, opts),
  commit: (path, message, amend) => repo.commit(path, message, amend),
  headMessage: (path) => repo.headMessage(path),
  ignore: (path, pattern) => repo.ignore(path, pattern),

  checkout: (path, ref) => repo.checkout(path, ref),
  checkoutRemote: (path, ref) => repo.checkoutRemote(path, ref),
  checkoutDetached: (path, hash) => repo.checkoutDetached(path, hash),
  createBranch: (path, name, start, checkout) => repo.createBranch(path, name, start, checkout),
  renameBranch: (path, oldName, newName) => repo.renameBranch(path, oldName, newName),
  deleteBranch: (path, name, force) => repo.deleteBranch(path, name, force),
  deleteRemoteBranch: (path, remote, branch) => repo.deleteRemoteBranch(path, remote, branch, progress(path)),
  merge: (path, ref) => repo.merge(path, ref),
  rebase: (path, onto) => repo.rebase(path, onto),
  cherryPick: (path, hash) => repo.cherryPick(path, hash),
  revert: (path, hash) => repo.revert(path, hash),
  reset: (path, hash, mode) => repo.reset(path, hash, mode),
  abortOperation: (path) => repo.abortOperation(path),
  continueOperation: (path) => repo.continueOperation(path),
  createTag: (path, name, hash, message) => repo.createTag(path, name, hash, message),
  deleteTag: (path, name) => repo.deleteTag(path, name),

  stashSave: (path, message, paths) => repo.stashSave(path, message, paths),
  stashPop: (path, index, hash) => repo.stashPop(path, index, hash),
  stashApply: (path, index, hash) => repo.stashApply(path, index, hash),
  stashDrop: (path, index, hash) => repo.stashDrop(path, index, hash),
  stashUntrackedClashes: (path, index, hash) => repo.stashUntrackedClashes(path, index, hash),
  stashTrackedClashes: (path, index, hash) => repo.stashTrackedClashes(path, index, hash),

  fetch: (path, background) => repo.fetchAll(path, background ? () => {} : progress(path), !!background),
  pull: (path, mode) => repo.pull(path, mode, progress(path)),
  pullBranch: (path, branch) => repo.pullBranch(path, branch, progress(path)),
  push: (path, opts) => repo.push(path, opts, progress(path)),
  pushTag: (path, remote, tag) => repo.pushTag(path, remote, tag, progress(path)),
  addRemote: (path, name, url) => repo.addRemote(path, name, url),
  removeRemote: (path, name) => repo.removeRemote(path, name),

  openTerminal: (path) => tools.openTerminal(path),
  openPath: async (path) => {
    if (!statSync(path).isDirectory()) throw new Error('Only folders can be opened this way')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  },
  openRepoFile: async (repoPath, file) => {
    const full = repo.insideRepo(repoPath, file)
    const stat = lstatSync(full)
    const action = openAction(full, {
      symlink: stat.isSymbolicLink(),
      executable: process.platform !== 'win32' && (stat.mode & 0o111) !== 0
    })
    if (action === 'reveal') {
      shell.showItemInFolder(full)
      return 'revealed'
    }
    const error = await shell.openPath(full)
    if (error) throw new Error(error)
    return 'opened'
  },
  showInFolder: async (path) => shell.showItemInFolder(path),
  answerAskpass: async (id, value) => answerAskpass(id, value),
  listSshKeys: () => listKeys(),
  listAccounts: async () => accounts.listAccounts(),
  addAccount: (input) => accounts.addAccount(input),
  updateAccount: (id, patch) => accounts.updateAccount(id, patch),
  removeAccount: async (id) => accounts.removeAccount(id),
  listAccountRepos: (id) => accounts.listAccountRepos(id),
  getRepoAccount: async (path) => accounts.getRepoAccount(path),
  setRepoAccount: (path, id) => accounts.setRepoAccount(path, id),
  startGitHubLogin: () => accounts.startGitHubLogin(),
  finishGitHubLogin: () => accounts.finishGitHubLogin(),
  cancelGitHubLogin: async () => accounts.cancelGitHubLogin(),
  startGitLabLogin: () => accounts.startGitLabLogin(),
  finishGitLabLogin: () => accounts.finishGitLabLogin(),
  cancelGitLabLogin: async () => accounts.cancelGitLabLogin(),
  getPullRequests: (path) => accounts.getPullRequests(path),
  createPullRequest: (path, input) => accounts.createRepoPullRequest(path, input),
  closePullRequest: (path, number, url) => accounts.closeRepoPullRequest(path, number, url),
  reviewPullRequest: (path, pr) => accounts.reviewPullRequest(path, pr),
  getPullRequestComments: (path, number) => accounts.getPullRequestComments(path, number),
  commentOnPullRequest: (path, number, body) => accounts.commentOnPullRequest(path, number, body),
  approvePullRequest: (path, number, url, head) => accounts.approveRepoPullRequest(path, number, url, head),
  mergePullRequest: (path, number, url, method, head) => accounts.mergeRepoPullRequest(path, number, url, method, head),
  getMergeMethods: (path, targetBranch) => accounts.getMergeMethods(path, targetBranch),
  endPullRequestReview: (path, number) => repo.endPullRequestReview(path, number),
  getDefaultBranch: (path) => accounts.getDefaultBranch(path),
  checkoutPullRequest: (path, remote, pr, provider) => repo.checkoutPullRequest(path, remote, pr, provider),
  generateSshKey: (opts) => generateKey(opts, askpassScripts()),
  openInEditor: (path, file, line) => tools.openInEditor(path, file, line),
  openDiffTool: (path, source) => tools.openDiffTool(path, source),
  openMergeTool: (path, file) => tools.openMergeTool(path, file),
  takeLaunchFolders: async () => takeLaunchFolders(),
  installCommandLine: async () => {
    if (process.platform !== 'win32' || !app.isPackaged) throw new Error('Only the installed Windows app can do this')
    // The portable build runs from a temporary copy: the command must start the .exe the user keeps.
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
    return installCommandLine(exe, join(app.getPath('userData'), 'bin'))
  },
  commandLineInfo: async () => ({
    windows: process.platform === 'win32',
    packaged: app.isPackaged,
    command:
      process.platform === 'win32'
        ? null
        : `sudo ln -sf "${process.env.APPIMAGE || process.execPath}" /usr/local/bin/leviathan`
  }),
  getLfsInfo: (path) => lfs.getLfsInfo(path),
  getLfsLocks: (path, background) => lfs.getLfsLocks(path, !!background),
  lfsLock: (path, file) => lfs.lfsLock(path, file),
  lfsUnlock: (path, lock, force) => lfs.lfsUnlock(path, lock, force),
  lfsTrack: (path, pattern, lockable) => lfs.lfsTrack(path, pattern, lockable),
  lfsUntrack: (path, pattern) => lfs.lfsUntrack(path, pattern),
  lfsMoveFiles: (path, paths) => lfs.lfsMoveFiles(path, paths),
  lfsRestage: (path, paths) => lfs.lfsRestage(path, paths),
  setupLfs: (path) => lfs.setupLfs(path, progress(path)),
  getSubmodules: (path) => submodules.getSubmodules(path),
  updateSubmodules: (path, paths) => submodules.updateSubmodules(path, paths, progress(path)),
  openExternal: async (url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened')
    await shell.openExternal(url)
  }
}

/** `leviathan <folder>` while the app runs: the window opens it in a tab. */
export function sendOpenFolder(folder: string): void {
  broadcast(IPC_OPEN_FOLDER, folder)
}

/** Update checks start once the window can hear about them. */
export function startUpdates(): void {
  initUpdates((state) => broadcast(IPC_UPDATE, state))
}

export function registerIpc(): void {
  const allowed = new Set<string>(API_METHODS)
  ipcMain.handle(IPC_INVOKE, async (_event, method: string, args: unknown[]): Promise<IpcResult<unknown>> => {
    if (!allowed.has(method)) return { ok: false, error: `Unknown method: ${method}` }
    try {
      const fn = handlers[method as keyof LeviathanInvokeApi] as (...a: unknown[]) => Promise<unknown>
      return { ok: true, value: await fn(...(Array.isArray(args) ? args : [])) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
