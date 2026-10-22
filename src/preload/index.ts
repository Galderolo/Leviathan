import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  API_METHODS,
  IPC_INVOKE,
  IPC_ASKPASS,
  IPC_PROGRESS,
  IPC_REPO_CHANGED,
  IPC_UPDATE,
  type LeviathanApi,
  type IpcResult
} from '../shared/api'
import type { AskpassRequest, ProgressEvent, RepoChangedEvent } from '../shared/types'
import type { UpdateState } from '../shared/updates'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Record<string, unknown> = {
  onRepoChanged: (cb: (e: RepoChangedEvent) => void) => subscribe(IPC_REPO_CHANGED, cb),
  onProgress: (cb: (e: ProgressEvent) => void) => subscribe(IPC_PROGRESS, cb),
  onAskpass: (cb: (e: AskpassRequest) => void) => subscribe(IPC_ASKPASS, cb),
  onUpdate: (cb: (state: UpdateState) => void) => subscribe(IPC_UPDATE, cb)
}

for (const method of API_METHODS) {
  api[method] = async (...args: unknown[]) => {
    const result = (await ipcRenderer.invoke(IPC_INVOKE, method, args)) as IpcResult<unknown>
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
}

contextBridge.exposeInMainWorld('leviathan', api as unknown as LeviathanApi)
