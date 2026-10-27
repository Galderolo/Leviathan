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
  // From the leviathan command: the portable build runs in a temporary folder, not where the command was typed.
  const base = argv.find((a) => a.startsWith('--cwd='))?.slice('--cwd='.length) || cwd
  const path = /^[A-Za-z]:[\\/]|^\\\\/.test(base) || /^[A-Za-z]:[\\/]/.test(last) ? win32 : posix
  return path.resolve(base, last)
}

/**
 * `leviathan.cmd`: starts the app with the folder the command was typed in. cmd reads the file in the console code
 * page, so user folders are named by their variables and any other non-ASCII path is refused.
 */
export function commandShim(exe: string, env: Record<string, string | undefined>): string {
  let target = exe
  const vars = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE']
    .filter((name) => env[name])
    .sort((a, b) => env[b]!.length - env[a]!.length)
  const name = vars.find((v) => exe.toLowerCase().startsWith(env[v]!.replace(/\\+$/, '').toLowerCase() + '\\'))
  let prefix = ''
  if (name) {
    prefix = `%${name}%`
    target = exe.slice(env[name]!.replace(/\\+$/, '').length)
  }
  if (/[^\x20-\x7e]/.test(target)) {
    throw new Error(`The command cannot start Leviathan from ${exe}: move it to a folder without accents or symbols.`)
  }
  // `\.` keeps a drive root such as C:\ from ending in \" (an escaped quote).
  return `@echo off\r\nstart "" "${prefix}${target.replace(/%/g, '%%')}" --cwd="%CD%\\." %*\r\n`
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

// Folders from the command line wait here until the window has restored its tabs and asks for them: opened
// earlier, they would race with that restore.
const launch = { folders: [] as string[], windowReady: false }

/** A folder from the command line: `send` it to the window now, or it was `queued` until the window asks. */
export function offerLaunchFolder(folder: string): 'send' | 'queued' {
  if (launch.windowReady) return 'send'
  launch.folders.push(folder)
  return 'queued'
}

/** The window has restored its tabs: it takes the queued folders, and later ones are sent as they come. */
export function takeLaunchFolders(): string[] {
  launch.windowReady = true
  return launch.folders.splice(0)
}

/** The window (re)loads: folders wait again until it asks. */
export function windowLoading(): void {
  launch.windowReady = false
}

const USER_ENV_KEY = 'HKCU:\\Environment'
// As base64 of UTF-16: PowerShell writes text to a pipe in the console code page, which would garble accents.
const READ_PATH =
  "[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-Item -Path $env:LEVIATHAN_ENV_KEY).GetValue('Path', '', 'DoNotExpandEnvironmentNames')))"
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
  await fs.writeFile(join(binDir, 'leviathan.cmd'), commandShim(exe, process.env), 'utf8')
  return addToUserPath(binDir, envKey)
}

/** Windows: adds `dir` to the user's PATH, and tells other programs it changed. `envKey`: another key in tests. */
export async function addToUserPath(dir: string, envKey = USER_ENV_KEY): Promise<'added' | 'present'> {
  const encoded = (await powershell(READ_PATH, { LEVIATHAN_ENV_KEY: envKey })).trim()
  const current = Buffer.from(encoded, 'base64').toString('utf16le')
  const next = addToPathList(current, dir)
  if (next === null) return 'present'
  await powershell(WRITE_PATH, { LEVIATHAN_ENV_KEY: envKey, LEVIATHAN_NEW_PATH: next })
  // Only for the real PATH: tests write elsewhere and must not touch the user's environment.
  if (envKey === USER_ENV_KEY) await powershell(ANNOUNCE, {})
  return 'added'
}
