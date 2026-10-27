import { promises as fs } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { lfsPatternFor, parseAttributes, parseLocks, parseMacros, parseVerifiedLocks } from '../../shared/lfs'
import type { LfsInfo, LfsLock, LfsPattern } from '../../shared/lfs'
import { addToPath } from '../pathEnv'
import { locateProgram } from '../programs'
import { insideRepo, type ProgressFn } from './repository'
import { NON_INTERACTIVE_ENV, git, type RunOptions } from './runner'
import { lfsFilesAmong, plainLfs, stagedBlobs, type StagedBlob } from './staged'

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

/**
 * Looks for git-lfs: on the PATH (`ask`), else where its installer puts it (`locate`), whose folder then goes on the
 * PATH (`add`) — Homebrew for an app opened from the Finder, a per-user install this process started before.
 * Callers asking at the same time share one lookup; a version found is kept, a missing one is looked for again.
 */
export function gitLfsFinder(
  ask: () => Promise<string | null>,
  locate: () => Promise<string | null>,
  add: (dir: string) => boolean
): () => Promise<string | null> {
  let found: string | null = null
  let lookup: Promise<string | null> | null = null
  const look = async () => {
    const version = await ask()
    if (version) return version
    const exe = await locate()
    if (!exe) return null
    add(dirname(exe))
    return ask()
  }
  return async () => {
    if (found) return found
    lookup ??= look().finally(() => (lookup = null))
    const version = await lookup
    if (version) found = version
    return version
  }
}

const findVersion = gitLfsFinder(
  () => askVersion(),
  () => locateProgram('git-lfs'),
  (dir) => addToPath(dir)
)

/** Installed git-lfs version, or null when it is missing (looked up again until found). */
export async function lfsVersion(): Promise<string | null> {
  // Only for the end-to-end tests: git for Windows ships git-lfs next to git, so it cannot be hidden from them.
  if (process.env.LEVIATHAN_E2E_NO_GIT_LFS) return null
  return findVersion()
}

async function askVersion(): Promise<string | null> {
  try {
    return /git-lfs\/(\S+)/.exec(await run(process.cwd(), ['lfs', 'version']))?.[1] ?? null
  } catch {
    // git-lfs is not installed
    return null
  }
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
  const texts: [string, string][] = []
  for (const source of sources) {
    try {
      const full = insideRepo(repo, source)
      // Like git, never follow a symlinked attributes file.
      if (!(await fs.lstat(full)).isFile()) continue
      texts.push([source, await fs.readFile(full, 'utf8')])
    } catch {
      // deleted in the working tree
    }
  }
  // Macros (`[attr]lfs filter=lfs …`) count only when defined in the root file, and apply everywhere.
  const macros = parseMacros(texts.find(([source]) => source === '.gitattributes')?.[1] ?? '')
  const patterns = texts.flatMap(([source, text]) => parseAttributes(text, source, macros))
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
/** git-lfs's answer when the server has no locking API (Bitbucket Cloud answers 404: "Repository or object not found"). */
const NO_LOCKING_API = /not found|does not support|not supported|\b404\b/i

export async function getLfsLocks(
  repo: string,
  background = false
): Promise<{ locks: LfsLock[]; verified: boolean; unsupported?: boolean }> {
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
  if (!unverified.length) {
    // --json hides errors: ask again for git-lfs's reason, which tells a server without locks from a broken one.
    try {
      await locks([])
    } catch (err) {
      if (err instanceof Error && NO_LOCKING_API.test(err.message))
        return { locks: [], verified: false, unsupported: true }
      throw err
    }
  }
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

const LITERAL = { GIT_LITERAL_PATHSPECS: '1' }

/**
 * Staged files whose working copy is not byte for byte what is staged. Compared without filters: once
 * a file goes through LFS, git compares the staged content with the cleaned (pointer) working copy and
 * always sees a change.
 */
async function changedSinceStaged(repo: string, blobs: StagedBlob[]): Promise<string[]> {
  const comparable: StagedBlob[] = []
  const changed: string[] = []
  for (const blob of blobs) {
    let file = false
    try {
      file = !blob.path.includes('\n') && (await fs.lstat(insideRepo(repo, blob.path))).isFile()
    } catch {
      // deleted since it was staged
    }
    if (file) comparable.push(blob)
    else changed.push(blob.path)
  }
  if (comparable.length) {
    const out = await run(repo, ['hash-object', '--no-filters', '--stdin-paths'], {
      input: comparable.map((b) => b.path).join('\n') + '\n'
    })
    const hashes = out.split('\n')
    comparable.forEach((b, i) => hashes[i]?.trim() !== b.hash && changed.push(b.path))
  }
  return changed
}

/** Stages the attributes files that changed, so pointers never get committed without the pattern that explains them. */
async function stageAttributes(repo: string): Promise<void> {
  const out = await run(repo, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ':(glob)**/.gitattributes'
  ])
  const entries = out.split('\0')
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    if (entry[0] === 'R' || entry[0] === 'C') i++
    if (entry[1] !== ' ') paths.push(entry.slice(3))
  }
  if (paths.length) await run(repo, ['add', '-A', '--', ...paths], { env: LITERAL })
}

/** Stages files again through the LFS filters (as pointers), with the attributes files. */
async function renormalize(repo: string, files: string[]): Promise<void> {
  if (!files.length) return
  await run(repo, ['add', '--renormalize', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    input: files.join('\0'),
    env: LITERAL
  })
  await stageAttributes(repo)
}

/** The staged entries of `paths`, refusing any whose working copy changed since: staging it again would replace the staged version. */
async function stagedUnchanged(repo: string, paths: string[]): Promise<StagedBlob[]> {
  const wanted = new Set(paths.map((p) => repoPath(repo, p)))
  const staged = (await stagedBlobs(repo)).filter((b) => wanted.has(b.path))
  const changed = await changedSinceStaged(repo, staged)
  if (changed.length) {
    throw new Error(
      `${changed.join(', ')}: the working copy has unstaged changes. Stage it again to store it with Git LFS as it is now.`
    )
  }
  return staged
}

/**
 * Tracks a pattern in the root `.gitattributes` (git-lfs escapes it and installs the repository hooks).
 * Files already staged that the pattern now covers are staged again through LFS, unless their working copy changed since.
 */
export async function lfsTrack(repo: string, pattern: string, lockable: boolean): Promise<void> {
  assertPattern(pattern)
  await run(repo, ['lfs', 'track', ...(lockable ? ['--lockable'] : []), '--', pattern])
  const blobs = await stagedBlobs(repo)
  const plain = plainLfs(
    blobs,
    await lfsFilesAmong(
      repo,
      blobs.map((b) => b.path)
    )
  )
  const changed = new Set(await changedSinceStaged(repo, plain))
  await renormalize(
    repo,
    plain.filter((b) => !changed.has(b.path)).map((b) => b.path)
  )
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
  const staged = await stagedUnchanged(repo, paths)
  if (!staged.length) return
  for (const pattern of new Set(staged.map((b) => lfsPatternFor(b.path)))) {
    await run(repo, ['lfs', 'track', '--', pattern])
  }
  await renormalize(
    repo,
    staged.map((b) => b.path)
  )
}

/** Stages again through LFS files that should go through it but were staged with their whole content. */
export async function lfsRestage(repo: string, paths: string[]): Promise<void> {
  const staged = await stagedUnchanged(repo, paths)
  await renormalize(
    repo,
    staged.map((b) => b.path)
  )
}

/** Configures git-lfs for the user and this repository, then downloads the repository's LFS files. */
export async function setupLfs(repo: string, onProgress: ProgressFn): Promise<void> {
  await run(repo, ['lfs', 'install'])
  if ((await run(repo, ['remote'])).trim()) await run(repo, ['lfs', 'pull'], { onProgress })
}
