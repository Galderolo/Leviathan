import { spawn as spawnDirect } from 'node:child_process'
import { existsSync } from 'node:fs'
import spawn from 'cross-spawn'
import { difftoolArgs, editorArgs, mergetoolArgs, terminalArgs, windowsStartLine } from '../shared/externalTools'
import { settingsFor } from '../shared/repoSettings'
import type { DiffSource } from '../shared/types'
import { insideRepo } from './git/repository'
import { git } from './git/runner'
import { findProgram, locateProgram } from './programs'
import { commandProcessor } from './programSearch'
import { loadSettings } from './settings'
import { openSystemTerminal } from './shell'

/** Thrown when no diff or merge tool is chosen in Settings nor configured in git: git would fall back to vimdiff. */
export const NO_DIFF_TOOL = 'NO_DIFF_TOOL'

/**
 * Starts a program detached from the app and returns once it runs, or with why it could not start. `strict`: an
 * error exit right away is a failure too (`open -a` with an app that is not installed).
 */
function launch(args: string[], cwd: string, strict = false): Promise<void> {
  return new Promise((resolve, reject) => {
    // cross-spawn runs .cmd launchers (code.cmd, subl.cmd…) through cmd.exe with every argument escaped,
    // so a file name with & or % stays a file name.
    const child = spawn(args[0], args.slice(1), { cwd, detached: true, stdio: 'ignore', windowsHide: true })
    let started: NodeJS.Timeout | undefined
    child.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(started)
      reject(
        err.code === 'ENOENT'
          ? new Error(
              `"${args[0]}" was not found. Check the editor in Settings, or pick "Other (command)" there with the full path of its program.`
            )
          : err
      )
    })
    // On Windows a program that is not on the PATH runs through cmd.exe, which starts fine and only then fails:
    // cross-spawn turns that early exit into ENOENT. Wait a moment for it before saying the editor started.
    child.once('spawn', () => {
      child.unref()
      started = setTimeout(resolve, 1000)
    })
    child.once('exit', (code) => {
      clearTimeout(started)
      if (strict && code) reject(new Error(`"${args[0]}" could not be started (exit code ${code})`))
      else resolve()
    })
  })
}

/** Opens a file of the repository (at a line), or the repository itself, with the editor chosen in Settings. */
export async function openInEditor(repo: string, file: string | null, line?: number): Promise<void> {
  const template = settingsFor(loadSettings(), repo).editor.trim()
  if (!template) throw new Error('No editor is chosen in Settings')
  const args = editorArgs(template, { file: file ? insideRepo(repo, file) : undefined, line, folder: repo })
  // Rider, Visual Studio and others are often not on the PATH: look where their installers put them.
  if (args.length) args[0] = await findProgram(args[0])
  await launch(args, repo)
}

/**
 * Starts a program in a window of its own through cmd's `start`: a console program (PowerShell, cmd) started
 * directly from the app would get no window. Returns once `start` did.
 */
function startInWindow(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnDirect(commandProcessor(), [windowsStartLine(args)], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`"${args[0]}" could not be started (exit code ${code})`))
    )
  })
}

/** Opens the terminal chosen in Settings, or the system's, in the repository's folder. */
export async function openTerminal(repo: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const template = loadSettings().terminal.trim()
  if (!template) return openSystemTerminal(repo)
  if (!existsSync(repo)) throw new Error(`Folder does not exist: ${repo}`)
  const args = terminalArgs(template, repo)
  const program = args.length ? await locateProgram(args[0]) : null
  if (!program) {
    throw new Error(
      `"${args[0] ?? template}" was not found. Check the terminal in Settings, or pick "Other (command)" there with the full path of its program.`
    )
  }
  args[0] = program
  if (platform !== 'win32') return launch(args, repo, true)
  // cmd expands %…% even inside quotes, so such a folder would turn into another one.
  if (template.includes('{folder}') && repo.includes('%')) {
    throw new Error(
      'This folder\'s path has a % in it, which cmd would read as a variable: use "." instead of {folder} in the terminal command.'
    )
  }
  await startInWindow(args, repo)
}

/** Whether git has a tool set under any of `keys` for this repository. */
async function configured(repo: string, keys: string[]): Promise<boolean> {
  for (const key of keys) {
    const { stdout } = await git(['config', '--get', key], { cwd: repo, okCodes: [0, 1] })
    if (stdout.trim()) return true
  }
  return false
}

function assertHash(value: string | null): void {
  if (value !== null && !/^[0-9a-f]{4,64}$/i.test(value)) throw new Error(`Invalid commit: "${value}"`)
}

/**
 * Runs a git command that opens an external tool. The tool stays open as long as the user wants: wait only long
 * enough to report a tool that fails to start.
 */
function startGitTool(repo: string, args: string[]): Promise<void> {
  // Paths are file names, not patterns: [id].tsx must not also match i.tsx. On Windows the tool runs through git's
  // sh, which would also expand [id].tsx as a pattern when it starts unless told not to (MSYS=noglob).
  const msys = [process.env.MSYS, 'noglob'].filter(Boolean).join(' ')
  const running = git(args, { cwd: repo, env: { GIT_LITERAL_PATHSPECS: '1', MSYS: msys } })
  running.catch(() => {})
  return Promise.race([running.then(() => undefined), new Promise<void>((r) => setTimeout(r, 1500))])
}

export async function openDiffTool(repo: string, source: DiffSource): Promise<void> {
  insideRepo(repo, source.path)
  if (source.kind === 'commit') {
    assertHash(source.hash)
    assertHash(source.parent)
    if (source.oldPath) insideRepo(repo, source.oldPath)
  }
  const tool = settingsFor(loadSettings(), repo).diffTool || null
  // git difftool falls back to merge.tool when diff.tool is not set.
  if (!tool && !(await configured(repo, ['diff.tool', 'merge.tool']))) throw new Error(NO_DIFF_TOOL)
  await startGitTool(repo, difftoolArgs(source, tool))
}

export async function openMergeTool(repo: string, file: string): Promise<void> {
  insideRepo(repo, file)
  // git mergetool loops over its files unquoted: its shell would expand [id].tsx into another file's name.
  if (/[*?[\]]/.test(file)) {
    throw new Error('The merge tool cannot open a file whose name has [ ] * or ?. Resolve it in the conflict editor.')
  }
  const tool = settingsFor(loadSettings(), repo).diffTool || null
  if (!tool && !(await configured(repo, ['merge.tool']))) throw new Error(NO_DIFF_TOOL)
  // No *.orig copies left next to the file once it is resolved.
  await startGitTool(repo, ['-c', 'mergetool.keepBackup=false', ...mergetoolArgs(file, tool)])
}
