import spawn from 'cross-spawn'
import { difftoolArgs, editorArgs, mergetoolArgs } from '../shared/externalTools'
import type { DiffSource } from '../shared/types'
import { insideRepo } from './git/repository'
import { git } from './git/runner'
import { loadSettings } from './settings'

/** Thrown when no diff or merge tool is chosen in Settings nor configured in git: git would fall back to vimdiff. */
export const NO_DIFF_TOOL = 'NO_DIFF_TOOL'

/** Starts a program detached from the app and returns once it runs, or with why it could not start. */
function launch(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // cross-spawn runs .cmd launchers (code.cmd, subl.cmd…) through cmd.exe with every argument escaped,
    // so a file name with & or % stays a file name.
    const child = spawn(args[0], args.slice(1), { cwd, detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'ENOENT' ? new Error(`"${args[0]}" was not found. Check the editor in Settings.`) : err)
    )
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Opens a file of the repository (at a line), or the repository itself, with the editor chosen in Settings. */
export async function openInEditor(repo: string, file: string | null, line?: number): Promise<void> {
  const template = loadSettings().editor.trim()
  if (!template) throw new Error('No editor is chosen in Settings')
  const args = editorArgs(template, { file: file ? insideRepo(repo, file) : undefined, line, folder: repo })
  await launch(args, repo)
}

async function configured(repo: string, key: string): Promise<boolean> {
  const { stdout } = await git(['config', '--get', key], { cwd: repo, okCodes: [0, 1] })
  return !!stdout.trim()
}

/**
 * Runs a git command that opens an external tool. The tool stays open as long as the user wants: wait only long
 * enough to report a tool that fails to start.
 */
function startGitTool(repo: string, args: string[]): Promise<void> {
  const running = git(args, { cwd: repo })
  running.catch(() => {})
  return Promise.race([running.then(() => undefined), new Promise<void>((r) => setTimeout(r, 1500))])
}

export async function openDiffTool(repo: string, source: DiffSource): Promise<void> {
  insideRepo(repo, source.path)
  const tool = loadSettings().diffTool || null
  if (!tool && !(await configured(repo, 'diff.tool'))) throw new Error(NO_DIFF_TOOL)
  await startGitTool(repo, difftoolArgs(source, tool))
}

export async function openMergeTool(repo: string, file: string): Promise<void> {
  insideRepo(repo, file)
  const tool = loadSettings().diffTool || null
  if (!tool && !(await configured(repo, 'merge.tool'))) throw new Error(NO_DIFF_TOOL)
  // No *.orig copies left next to the file once it is resolved.
  await startGitTool(repo, ['-c', 'mergetool.keepBackup=false', ...mergetoolArgs(file, tool)])
}
