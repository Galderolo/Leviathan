import { spawn } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'

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
  /** Fail at once when another git holds the index lock, instead of waiting a little for it. */
  noLockWait?: boolean
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
 * For background work (auto-fetch): never ask the user anything. The askpass
 * bridge only answers from stored accounts (no window), ssh may not prompt,
 * and Git Credential Manager stays silent.
 */
export const NON_INTERACTIVE_ENV: Record<string, string> = {
  LEVIATHAN_ASKPASS_MODE: 'accounts',
  SSH_ASKPASS: '',
  SSH_ASKPASS_REQUIRE: 'never',
  GCM_INTERACTIVE: 'never',
  GIT_TERMINAL_PROMPT: '0'
}

let appEnv: Record<string, string> = {}

/** Extra variables for every git invocation (e.g. the askpass bridge). */
export function setGitEnv(env: Record<string, string>): void {
  appEnv = { ...env }
}

const repoArgs = new Map<string, string[]>()

function repoKey(path: string): string {
  const full = resolve(path)
  return process.platform === 'win32' ? full.toLowerCase() : full
}

/**
 * Extra `-c` arguments for every git command run in `repo` (or a folder inside
 * it), e.g. the credentials of the account bound to it. `null` removes them.
 */
export function setRepoGitArgs(repo: string, args: string[] | null): void {
  if (args) repoArgs.set(repoKey(repo), [...args])
  else repoArgs.delete(repoKey(repo))
}

function within(repo: string, key: string): boolean {
  const rel = relative(repo, key)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function argsForCwd(cwd: string): string[] {
  const key = repoKey(cwd)
  // The innermost repository wins: a submodule opened in its own tab may use another account than its parent.
  let best: { repo: string; args: string[] } | null = null
  for (const [repo, args] of repoArgs) {
    if (within(repo, key) && (!best || repo.length > best.repo.length)) best = { repo, args }
  }
  return best?.args ?? []
}

/** Work that holds a repository's index lock (a stat refresh): other commands in that repository wait for it. */
const indexHolders = new Map<string, Promise<unknown>>()

/** Runs `work`, which holds `repo`'s index lock, making the app's other git commands in that repository wait for it. */
export function holdingIndex<T>(repo: string, work: () => Promise<T>): Promise<T> {
  const key = repoKey(repo)
  const done: Promise<T> = work().finally(() => {
    if (indexHolders.get(key) === done) indexHolders.delete(key)
  })
  indexHolders.set(key, done)
  return done
}

function indexHolderFor(cwd: string): Promise<unknown> | undefined {
  const key = repoKey(cwd)
  for (const [repo, held] of indexHolders) if (within(repo, key)) return held
  return undefined
}

/** How long commands wait for the app's own index refresh before going ahead anyway (a filter may hang). */
const INDEX_HOLD_WAIT_MS = 10_000

function waitFor(held: Promise<unknown>): Promise<unknown> {
  return Promise.race([held.catch(() => {}), new Promise((r) => setTimeout(r, INDEX_HOLD_WAIT_MS))])
}

/**
 * Commands that take the index lock before changing anything. When another git (a terminal, an IDE, a background
 * refresh) holds it, they fail without having done anything, so they are simply tried again for a moment.
 */
const LOCKING = new Set([
  'add',
  'commit',
  'restore',
  'reset',
  'rm',
  'mv',
  'apply',
  'update-index',
  'checkout',
  'switch'
])
const LOCK_WAIT_MS = 2000
const LOCK_RETRY_MS = 150

function indexLocked(err: unknown): boolean {
  return err instanceof GitError && /index\.lock'?: File exists/.test(err.stderr)
}

/**
 * Runs git with an argument array (never through a shell) and collects output.
 */
export async function git(args: string[], opts: RunOptions): Promise<RunResult> {
  let waited = opts.noLockWait ? undefined : indexHolderFor(opts.cwd)
  if (waited) await waitFor(waited)
  let deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      return await gitOnce(args, opts)
    } catch (err) {
      if (opts.noLockWait || !LOCKING.has(args[0]) || !indexLocked(err)) throw err
      // The app's own refresh may have taken the lock after this command started: wait for it, then try afresh.
      const held = indexHolderFor(opts.cwd)
      if (held && held !== waited) {
        waited = held
        await waitFor(held)
        deadline = Date.now() + LOCK_WAIT_MS
        continue
      }
      if (Date.now() > deadline) throw err
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS))
    }
  }
}

function gitOnce(args: string[], opts: RunOptions): Promise<RunResult> {
  const fullArgs = [...BASE_ARGS, ...argsForCwd(opts.cwd), ...args]
  return new Promise((resolve, reject) => {
    const child = spawn('git', fullArgs, {
      cwd: opts.cwd,
      env: { ...process.env, ...BASE_ENV, ...appEnv, ...opts.env },
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
