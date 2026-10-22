import { promises as fs } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { lfsPatternFor, parseAttributes, parseLocks, parseVerifiedLocks } from '../../shared/lfs'
import type { LfsInfo, LfsLock, LfsPattern } from '../../shared/lfs'
import { insideRepo, type ProgressFn } from './repository'
import { NON_INTERACTIVE_ENV, git, type RunOptions } from './runner'

async function run(cwd: string, args: string[], extra: Partial<RunOptions> = {}): Promise<string> {
  return (await git(args, { cwd, ...extra })).stdout
}

/** Repository-relative, `/`-separated path of a file inside the repository. */
function repoPath(repo: string, file: string): string {
  return relative(repo, insideRepo(repo, file)).split(sep).join('/')
}

function assertPattern(pattern: string): void {
  if (!pattern.trim() || /[\r\n\0]/.test(pattern)) throw new Error(`Invalid pattern: "${pattern}"`)
}

let version: string | null = null

/** Installed git-lfs version, or null when it is missing (looked up again until found). */
export async function lfsVersion(): Promise<string | null> {
  if (version) return version
  try {
    const out = await run(process.cwd(), ['lfs', 'version'])
    version = /git-lfs\/(\S+)/.exec(out)?.[1] ?? null
  } catch {
    // git-lfs is not installed
  }
  return version
}

async function filtersConfigured(repo: string): Promise<boolean> {
  const { exitCode } = await git(['config', '--get-regexp', '^filter\\.lfs\\.(process|smudge)$'], {
    cwd: repo,
    okCodes: [0, 1]
  })
  return exitCode === 0
}

async function hooksInstalled(repo: string): Promise<boolean> {
  const hook = (await run(repo, ['rev-parse', '--git-path', 'hooks/pre-push'])).trim()
  try {
    return /git[ -]lfs/.test(await fs.readFile(resolve(repo, hook), 'utf8'))
  } catch {
    return false
  }
}

/** Which patterns go through LFS (read without git-lfs, so a missing install can be reported), and whether it is set up. */
export async function getLfsInfo(repo: string): Promise<LfsInfo> {
  const listed = await run(repo, ['ls-files', '-z', '--cached', '--', ':(glob)**/.gitattributes'])
  const sources = [...new Set(['.gitattributes', ...listed.split('\0').filter(Boolean)])]
  const patterns: LfsPattern[] = []
  for (const source of sources) {
    try {
      const full = insideRepo(repo, source)
      // Like git, never follow a symlinked attributes file.
      if (!(await fs.lstat(full)).isFile()) continue
      patterns.push(...parseAttributes(await fs.readFile(full, 'utf8'), source))
    } catch {
      // deleted in the working tree
    }
  }
  const installed = await lfsVersion()
  const [filters, hooks] = installed
    ? await Promise.all([filtersConfigured(repo), hooksInstalled(repo)])
    : [false, false]
  return { version: installed, used: patterns.length > 0, filters, hooks, patterns }
}

/**
 * Locks on the LFS server, telling the user's own from the others when the server can.
 * `--json` hides errors (an unreachable server lists nothing), so an empty list is asked again without it.
 */
export async function getLfsLocks(repo: string, background = false): Promise<{ locks: LfsLock[]; verified: boolean }> {
  const env = background ? NON_INTERACTIVE_ENV : undefined
  const locks = (args: string[]) => run(repo, ['lfs', 'locks', ...args], { env })
  const verified = parseVerifiedLocks(await locks(['--verify', '--json']))
  if (verified.length) return { locks: verified, verified: true }
  try {
    await locks(['--verify'])
    return { locks: [], verified: true }
  } catch {
    // The server may not support verifying: list the locks without telling whose they are.
  }
  const unverified = parseLocks(await locks(['--json']), null)
  if (!unverified.length) await locks([])
  return { locks: unverified, verified: false }
}

export async function lfsLock(repo: string, path: string): Promise<LfsLock> {
  const [lock] = parseLocks(await run(repo, ['lfs', 'lock', '--json', '--', repoPath(repo, path)]), true)
  if (!lock) throw new Error(`Could not lock ${path}`)
  return lock
}

/**
 * Releases a lock. The user's own is released by path, so git-lfs refuses while the file has
 * uncommitted changes; `force` releases someone else's lock by id.
 */
export async function lfsUnlock(repo: string, lock: { id: string; path: string }, force: boolean): Promise<void> {
  if (!lock.id || /\s/.test(lock.id) || lock.id.startsWith('-')) throw new Error(`Invalid lock: "${lock.id}"`)
  const path = repoPath(repo, lock.path)
  let exists = false
  try {
    await fs.lstat(insideRepo(repo, path))
    exists = true
  } catch {
    // deleted or never checked out here
  }
  const args =
    exists && !force
      ? ['lfs', 'unlock', '--', path]
      : ['lfs', 'unlock', ...(force ? ['--force'] : []), `--id=${lock.id}`]
  try {
    await run(repo, args)
  } catch (err) {
    // git-lfs also fails when it cannot reset the file's permissions after the server released the lock.
    const now = await getLfsLocks(repo).catch(() => null)
    if (now && !now.locks.some((l) => l.id === lock.id)) return
    throw err
  }
}

/** Tracks a pattern in the root `.gitattributes` (git-lfs escapes it and installs the repository hooks). */
export async function lfsTrack(repo: string, pattern: string, lockable: boolean): Promise<void> {
  assertPattern(pattern)
  await run(repo, ['lfs', 'track', ...(lockable ? ['--lockable'] : []), '--', pattern])
}

/** Removes a pattern from the attributes file it was read from. */
export async function lfsUntrack(repo: string, pattern: LfsPattern): Promise<void> {
  assertPattern(pattern.pattern)
  const file = insideRepo(repo, pattern.source)
  if (basename(file) !== '.gitattributes') throw new Error(`Not an attributes file: ${pattern.source}`)
  await run(dirname(file), ['lfs', 'untrack', '--', pattern.pattern])
}

/** Sends staged files through LFS: tracks their extensions, stages them again as pointers, stages `.gitattributes`. */
export async function lfsMoveFiles(repo: string, paths: string[]): Promise<void> {
  const files = paths.map((p) => repoPath(repo, p))
  if (!files.length) return
  for (const pattern of new Set(files.map(lfsPatternFor))) await lfsTrack(repo, pattern, false)
  const literal = { GIT_LITERAL_PATHSPECS: '1' }
  await run(repo, ['add', '--renormalize', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    input: files.join('\0'),
    env: literal
  })
  await run(repo, ['add', '--', '.gitattributes'], { env: literal })
}

/** Configures git-lfs for the user and this repository, then downloads the repository's LFS files. */
export async function setupLfs(repo: string, onProgress: ProgressFn): Promise<void> {
  await run(repo, ['lfs', 'install'])
  if ((await run(repo, ['remote'])).trim()) await run(repo, ['lfs', 'pull'], { onProgress })
}
