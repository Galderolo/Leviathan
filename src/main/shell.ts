import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { commandProcessor } from './programSearch'

/**
 * Formats that the usual default apps only display or edit. Anything else may be
 * associated with an interpreter (.py, .rb, .js...) or run directly, so it is only
 * revealed in the file manager. An allowlist, because a blocklist always misses one.
 */
// prettier-ignore
const SAFE_TO_OPEN = new Set([
  // text and data
  '.txt', '.md', '.markdown', '.rst', '.json', '.jsonc', '.yml', '.yaml', '.toml',
  '.ini', '.cfg', '.conf', '.csv', '.tsv', '.log', '.xml',
  // images and documents
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff', '.pdf',
  // source files usually opened by editors, never by interpreters
  '.ts', '.tsx', '.jsx', '.css', '.scss', '.less', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.java', '.kt', '.go', '.rs', '.swift', '.vue', '.svelte'
])

/** Whether to open a repository file with its default app or only reveal it in its folder. */
export function openAction(path: string, info: { symlink: boolean; executable: boolean }): 'open' | 'reveal' {
  if (info.symlink || info.executable) return 'reveal'
  // Windows strips trailing dots and spaces, so "run.bat." would open as run.bat.
  if (/[. ]$/.test(path)) return 'reveal'
  return SAFE_TO_OPEN.has(extname(path).toLowerCase()) ? 'open' : 'reveal'
}

function launch(command: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore' })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

/**
 * Opens the platform terminal in `dir` (no terminal chosen in Settings). The directory is passed as the
 * working directory, never interpolated into a shell command line.
 */
export async function openSystemTerminal(dir: string): Promise<void> {
  if (!existsSync(dir)) throw new Error(`Folder does not exist: ${dir}`)
  if (process.platform === 'win32') {
    const cmd = commandProcessor()
    if (await launch(cmd, ['/c', 'start', cmd], dir)) return
  } else if (process.platform === 'darwin') {
    if (await launch('open', ['-a', 'Terminal', dir], dir)) return
  } else {
    for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']) {
      if (await launch(term, [], dir)) return
    }
  }
  throw new Error('Could not open a terminal')
}
