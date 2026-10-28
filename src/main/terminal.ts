import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import { splitCommand } from '../shared/externalTools'
import { locateProgram } from './programs'

/** The program a console runs, with its arguments. */
export interface Shell {
  file: string
  args: string[]
}

/** What is installed among the shells Settings can name on Windows. */
export interface ShellsFound {
  pwsh: boolean
  /** Git for Windows' bash.exe, or null. */
  gitBash: string | null
}

/**
 * The shell of the console inside the app. On Windows, the one chosen as the terminal in Settings when it is a shell
 * (Command Prompt, PowerShell 7, Git Bash) and installed, Windows PowerShell otherwise; elsewhere, the user's own.
 */
export function shellFor(platform: string, terminal: string, env: NodeJS.ProcessEnv, found: ShellsFound): Shell {
  if (platform === 'win32') {
    const program = (splitCommand(terminal)[0] ?? '').toLowerCase().replace(/\.exe$/, '')
    if (program === 'cmd') return { file: 'cmd.exe', args: [] }
    if (program === 'pwsh' && found.pwsh) return { file: 'pwsh.exe', args: ['-NoLogo'] }
    if (program === 'git-bash' && found.gitBash) return { file: found.gitBash, args: ['--login', '-i'] }
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // Terminals on macOS start login shells: the PATH and settings of the user's profile.
  return { file: shell, args: platform === 'darwin' ? ['-l'] : [] }
}

/** Git for Windows' bash.exe, next to the git on the PATH (`<Git>\cmd\git.exe` or `<Git>\mingw64\bin\git.exe`). */
async function findGitBash(): Promise<string | null> {
  const git = await locateProgram('git')
  if (!git) return null
  const dir = dirname(git)
  for (const root of [dirname(dir), dirname(dirname(dir))]) {
    const bash = join(root, 'bin', 'bash.exe')
    if (existsSync(bash)) return bash
  }
  return null
}

/** The shell for the console inside the app, with `terminal` the terminal chosen in Settings. */
export async function integratedShell(terminal: string): Promise<Shell> {
  const found: ShellsFound =
    process.platform === 'win32'
      ? { pwsh: !!(await locateProgram('pwsh')), gitBash: await findGitBash() }
      : { pwsh: false, gitBash: null }
  return shellFor(process.platform, terminal, process.env, found)
}

/** The app's environment for a console, without Electron's own switches (a `code` started there must be itself). */
export function terminalEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !key.toUpperCase().startsWith('ELECTRON_')) out[key] = value
  }
  return { ...out, COLORTERM: 'truecolor' }
}

export interface TerminalEvents {
  data(id: number, data: string): void
  exit(id: number, code: number): void
}

type PtyModule = Pick<typeof import('node-pty'), 'spawn'>

/** Consoles (pseudo-terminals) for the panel at the bottom of a repository, by id. */
export class Terminals {
  private readonly ptys = new Map<number, IPty>()
  private last = 0

  constructor(
    private readonly events: TerminalEvents,
    // Loaded on first use: the app works without it if the native module cannot load on this system.
    private readonly load: () => Promise<PtyModule> = () => import('node-pty')
  ) {}

  /** Starts `shell` in `cwd`; its output and its end come through the events, under the id returned. */
  async start(shell: Shell, cwd: string, cols: number, rows: number): Promise<number> {
    const { spawn } = await this.load()
    const id = ++this.last
    const pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: terminalEnv(process.env)
    })
    this.ptys.set(id, pty)
    pty.onData((data) => this.events.data(id, data))
    pty.onExit(({ exitCode }) => {
      // Ended on its own (`exit`): on Windows node-pty lets go of the console's thread only when it is killed, and
      // until then the app cannot quit.
      if (this.ptys.delete(id) && process.platform === 'win32') pty.kill()
      this.events.exit(id, exitCode)
    })
    return id
  }

  write(id: number, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    this.ptys.get(id)?.resize(cols, rows)
  }

  stop(id: number): void {
    const pty = this.ptys.get(id)
    this.ptys.delete(id)
    pty?.kill()
  }

  stopAll(): void {
    for (const id of [...this.ptys.keys()]) this.stop(id)
  }
}
