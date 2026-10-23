import { randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC_ASKPASS } from '../../shared/api'
import type { AskpassRequest } from '../../shared/types'
import { answerFromAccounts, type AccountCredentials } from '../accounts/auth'
import { setGitEnv } from '../git/runner'
import { startAskpassServer, type AskpassBridge } from './server'

const TIMEOUT_MS = 5 * 60 * 1000
const pending = new Map<string, (value: string | null) => void>()
let bridge: AskpassBridge | null = null

let accountSource: () => AccountCredentials[] = () => []

/** Where stored account credentials come from (set by the accounts module). */
export function setAccountSource(source: () => AccountCredentials[]): void {
  accountSource = source
}

/**
 * Answers from a stored account when one matches; otherwise sends the prompt to
 * the app window and waits for the user's answer (null = cancelled).
 */
async function ask(prompt: string, context: { interactive: boolean }): Promise<string | null> {
  let automatic: string | null = null
  try {
    automatic = await answerFromAccounts(prompt, accountSource())
  } catch {
    // a broken account store or a failed renewal must never block the prompt itself
  }
  if (automatic !== null) return automatic
  if (!context.interactive) return null
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return null
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => answerAskpass(id, null), TIMEOUT_MS)
    pending.set(id, (value) => {
      clearTimeout(timer)
      resolve(value)
    })
    const request: AskpassRequest = { id, prompt }
    win.webContents.send(IPC_ASKPASS, request)
  })
}

export function answerAskpass(id: string, value: string | null): void {
  const resolve = pending.get(id)
  if (!resolve) return
  pending.delete(id)
  resolve(typeof value === 'string' ? value : null)
}

/** Routes git/ssh credential prompts of every git command to the app. */
export async function initAskpass(): Promise<void> {
  // Scripts must be executable from disk, so in packaged builds they live in app.asar.unpacked.
  const scriptDir = join(__dirname, '../../resources/askpass').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
  try {
    bridge = await startAskpassServer(ask, { scriptDir, nodePath: process.execPath })
    setGitEnv(bridge.env)
  } catch {
    // Without the bridge git still works with credential helpers and ssh-agent.
  }
}

export async function disposeAskpass(): Promise<void> {
  for (const id of [...pending.keys()]) answerAskpass(id, null)
  setGitEnv({})
  await bridge?.close()
  bridge = null
}
