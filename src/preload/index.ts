import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  API_METHODS,
  IPC_INVOKE,
  IPC_ASKPASS,
  IPC_PROGRESS,
  IPC_REPO_CHANGED,
  IPC_UPDATE,
  IPC_OPEN_FOLDER,
  IPC_TERMINAL_DATA,
  IPC_TERMINAL_EXIT,
  type LeviathanApi,
  type IpcResult,
  type TerminalData,
  type TerminalExit
} from '../shared/api'
import type { AskpassRequest, ProgressEvent, RepoChangedEvent } from '../shared/types'
import type { UpdateState } from '../shared/updates'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Record<string, unknown> = {
  platform: process.platform,
  onRepoChanged: (cb: (e: RepoChangedEvent) => void) => subscribe(IPC_REPO_CHANGED, cb),
  onProgress: (cb: (e: ProgressEvent) => void) => subscribe(IPC_PROGRESS, cb),
  onAskpass: (cb: (e: AskpassRequest) => void) => subscribe(IPC_ASKPASS, cb),
  onUpdate: (cb: (state: UpdateState) => void) => subscribe(IPC_UPDATE, cb),
  onOpenFolder: (cb: (folder: string) => void) => subscribe(IPC_OPEN_FOLDER, cb),
  onTerminalData: (cb: (e: TerminalData) => void) => subscribe(IPC_TERMINAL_DATA, cb),
  onTerminalExit: (cb: (e: TerminalExit) => void) => subscribe(IPC_TERMINAL_EXIT, cb)
}

for (const method of API_METHODS) {
  api[method] = async (...args: unknown[]) => {
    const result = (await ipcRenderer.invoke(IPC_INVOKE, method, args)) as IpcResult<unknown>
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
}

contextBridge.exposeInMainWorld('leviathan', api as unknown as LeviathanApi)
