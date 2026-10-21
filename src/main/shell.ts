import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

/** Extensions the OS runs (or imports) on double-click instead of opening in an editor. */
const EXECUTABLE_EXTENSIONS = new Set([
  '.app',
  '.appimage',
  '.bat',
  '.bin',
  '.cmd',
  '.com',
  '.command',
  '.cpl',
  '.desktop',
  '.exe',
  '.hta',
  '.jar',
  '.js',
  '.jse',
  '.lnk',
  '.msc',
  '.msi',
  '.pif',
  '.ps1',
  '.psm1',
  '.reg',
  '.run',
  '.scr',
  '.sh',
  '.url',
  '.vbe',
  '.vbs',
  '.wsf',
  '.wsh'
])

export function isExecutableFile(path: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extname(path).toLowerCase())
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
 * Opens the platform terminal in `dir`. The directory is passed as the
 * working directory, never interpolated into a shell command line.
 */
export async function openTerminal(dir: string): Promise<void> {
  if (!existsSync(dir)) throw new Error(`Folder does not exist: ${dir}`)
  if (process.platform === 'win32') {
    if (await launch('cmd.exe', ['/c', 'start', 'cmd.exe'], dir)) return
  } else if (process.platform === 'darwin') {
    if (await launch('open', ['-a', 'Terminal', dir], dir)) return
  } else {
    for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']) {
      if (await launch(term, [], dir)) return
    }
  }
  throw new Error('Could not open a terminal')
}
