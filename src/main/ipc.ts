import { lstatSync, statSync } from 'node:fs'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import {
  API_METHODS,
  IPC_INVOKE,
  IPC_PROGRESS,
  IPC_REPO_CHANGED,
  type LeviathanInvokeApi,
  type IpcResult
} from '../shared/api'
import * as accounts from './accounts'
import { answerAskpass } from './askpass'
import * as repo from './git/repository'
import { loadSettings, saveSettings } from './settings'
import { openAction, openTerminal } from './shell'
import { generateKey, listKeys } from './ssh'
import { watchRepo, unwatchRepo } from './watcher'

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

  openRepo: (path) => repo.openRepo(path),
  initRepo: (path, branch) => repo.initRepo(path, branch),
  cloneRepo: async (url, dest, accountId) => {
    const path = await repo.cloneRepo(url, dest, progress(dest), accountId ? accounts.cloneArgsFor(accountId) : [])
    if (accountId) await accounts.setRepoAccount(path, accountId)
    return path
  },
  watchRepo: async (path) => watchRepo(path, (e) => broadcast(IPC_REPO_CHANGED, e)),
  unwatchRepo: async (path) => unwatchRepo(path),

  getState: (path) => repo.getState(path),
  getLog: (path, limit) => repo.getLog(path, limit),
  getCommitDetails: (path, hash) => repo.getCommitDetails(path, hash),
  getDiff: (path, source) => repo.getDiff(path, source),
  getSnapshot: (path) => repo.getSnapshot(path),
  readWorkingFile: (path, file) => repo.readWorkingFile(path, file),
  resolveConflictFile: (path, file, content) => repo.resolveConflictFile(path, file, content),
  resolveConflictWith: (path, file, side) => repo.resolveConflictWith(path, file, side),
  applyChange: (path, change) => repo.applyChange(path, change),

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

  stashSave: (path, message) => repo.stashSave(path, message),
  stashPop: (path, index, hash) => repo.stashPop(path, index, hash),
  stashApply: (path, index, hash) => repo.stashApply(path, index, hash),
  stashDrop: (path, index, hash) => repo.stashDrop(path, index, hash),

  fetch: (path, background) => repo.fetchAll(path, background ? () => {} : progress(path), !!background),
  pull: (path, mode) => repo.pull(path, mode, progress(path)),
  push: (path, opts) => repo.push(path, opts, progress(path)),
  pushTag: (path, remote, tag) => repo.pushTag(path, remote, tag, progress(path)),
  addRemote: (path, name, url) => repo.addRemote(path, name, url),
  removeRemote: (path, name) => repo.removeRemote(path, name),

  openTerminal: (path) => openTerminal(path),
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
  generateSshKey: (opts) => generateKey(opts),
  openExternal: async (url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened')
    await shell.openExternal(url)
  }
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
