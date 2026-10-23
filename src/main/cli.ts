import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, posix, win32 } from 'node:path'

/**
 * The folder given on the command line (`leviathan .`), resolved against the directory it was typed in, or null.
 * `defaultApp`: started by electron itself, whose first argument that is not a switch is the app folder (development).
 */
export function launchFolder(argv: string[], cwd: string, defaultApp: boolean): string | null {
  const args = argv.slice(1).filter((a) => !a.startsWith('-'))
  if (defaultApp) args.shift()
  const last = args[args.length - 1]
  if (!last) return null
  const path = /^[A-Za-z]:[\\/]|^\\\\/.test(cwd) || /^[A-Za-z]:[\\/]/.test(last) ? win32 : posix
  return path.resolve(cwd, last)
}

/** The user's PATH with `dir` appended, or null when it is already there. */
export function addToPathList(current: string, dir: string): string | null {
  const norm = (p: string) =>
    p
      .trim()
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  const parts = current.split(';').filter((p) => p.trim())
  if (parts.some((p) => norm(p) === norm(dir))) return null
  return [...parts, dir].join(';')
}

let launchFolderPending: string | null = null

/** Remembers the folder the app was started with, until the window asks for it. */
export function setLaunchFolder(folder: string | null): void {
  launchFolderPending = folder
}

export function takeLaunchFolder(): string | null {
  const folder = launchFolderPending
  launchFolderPending = null
  return folder
}

const USER_ENV_KEY = 'HKCU:\\Environment'
const READ_PATH = "(Get-Item -Path $env:LEVIATHAN_ENV_KEY).GetValue('Path', '', 'DoNotExpandEnvironmentNames')"
// Written back as an expandable string (entries like %USERPROFILE%\bin keep working), then a user variable is set
// and removed so that Explorer and new terminals hear that the environment changed.
const WRITE_PATH =
  'Set-ItemProperty -Path $env:LEVIATHAN_ENV_KEY -Name Path -Value $env:LEVIATHAN_NEW_PATH -Type ExpandString'
const ANNOUNCE = [
  "[Environment]::SetEnvironmentVariable('LEVIATHAN_PATH_UPDATED', '1', 'User')",
  "[Environment]::SetEnvironmentVariable('LEVIATHAN_PATH_UPDATED', $null, 'User')"
].join('; ')

function powershell(script: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout))
    )
  })
}

/**
 * Windows: writes `leviathan.cmd` (starts the app with the folder given) in `binDir` and adds `binDir` to the user's
 * PATH. `envKey` is the registry key holding the PATH (another one in tests).
 */
export async function installCommandLine(
  exe: string,
  binDir: string,
  envKey = USER_ENV_KEY
): Promise<'added' | 'present'> {
  await fs.mkdir(binDir, { recursive: true })
  await fs.writeFile(join(binDir, 'leviathan.cmd'), `@echo off\r\nstart "" "${exe}" %*\r\n`, 'utf8')
  const current = (await powershell(READ_PATH, { LEVIATHAN_ENV_KEY: envKey })).trim()
  const next = addToPathList(current, binDir)
  if (next === null) return 'present'
  await powershell(WRITE_PATH, { LEVIATHAN_ENV_KEY: envKey, LEVIATHAN_NEW_PATH: next })
  // Only for the real PATH: tests write elsewhere and must not touch the user's environment.
  if (envKey === USER_ENV_KEY) await powershell(ANNOUNCE, {})
  return 'added'
}
