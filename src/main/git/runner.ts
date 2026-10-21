import { spawn } from 'node:child_process'

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface RunOptions {
  cwd: string
  /** Written to stdin, which is then closed. */
  input?: string
  env?: Record<string, string>
  /** Exit codes that count as success. Defaults to `[0]`. */
  okCodes?: number[]
  /** Receives each progress line git prints to stderr (`--progress`). */
  onProgress?: (line: string) => void
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Config overrides applied to every invocation so user configuration
 * cannot change the output formats we parse.
 */
// prettier-ignore
const BASE_ARGS = [
  '-c', 'color.ui=false',
  '-c', 'core.quotepath=false',
  '-c', 'log.showSignature=false',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false'
]

const BASE_ENV: Record<string, string> = {
  // Never block waiting for credentials on a terminal we do not have.
  GIT_TERMINAL_PROMPT: '0',
  // Read-only commands like `status` must not take the index lock
  // (also prevents refresh loops with the file watcher).
  GIT_OPTIONAL_LOCKS: '0',
  // Accept default messages instead of opening an editor.
  GIT_EDITOR: 'true'
}

/**
 * Runs git with an argument array (never through a shell) and collects output.
 */
export function git(args: string[], opts: RunOptions): Promise<RunResult> {
  const fullArgs = [...BASE_ARGS, ...args]
  return new Promise((resolve, reject) => {
    const child = spawn('git', fullArgs, {
      cwd: opts.cwd,
      env: { ...process.env, ...BASE_ENV, ...opts.env },
      windowsHide: true
    })

    const out: Buffer[] = []
    let stderr = ''
    let pending = ''

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr += text
      if (opts.onProgress) {
        pending += text
        const parts = pending.split(/[\r\n]/)
        pending = parts.pop() ?? ''
        for (const line of parts) if (line.trim()) opts.onProgress(line.trim())
      }
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      const message =
        err.code === 'ENOENT' ? 'Git executable not found. Install Git and make sure it is on your PATH.' : err.message
      reject(new GitError(message, args, null, ''))
    })

    child.on('close', (code) => {
      const exitCode = code ?? -1
      const stdout = Buffer.concat(out).toString('utf8')
      if ((opts.okCodes ?? [0]).includes(exitCode)) {
        resolve({ stdout, stderr, exitCode })
      } else {
        const message =
          cleanMessage(stderr) || cleanMessage(stdout) || `git ${args[0]} failed with exit code ${exitCode}`
        reject(new GitError(message, args, exitCode, stderr))
      }
    })

    // git may exit without reading stdin (EPIPE / EOF); the exit code still tells what happened.
    child.stdin.on('error', () => {})
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

function cleanMessage(text: string): string {
  return text
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(remote: )?(Counting|Compressing|Receiving|Resolving|Enumerating|Writing|Total)\b/.test(l))
    .join('\n')
}
