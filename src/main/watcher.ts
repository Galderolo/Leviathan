import { existsSync, type FSWatcher, promises as fs, readFileSync, statSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import type { RepoChangedEvent } from '../shared/types'
import { git } from './git/runner'

interface Entry {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
  kind: RepoChangedEvent['kind'] | null
  /** Working-tree paths changed since the last notification. */
  paths: Set<string>
  /** When the first change of the current batch arrived. */
  since: number
  /** The OS dropped paths (its change buffer overflowed during a burst): wait for quiet instead of reporting every 2 s. */
  unknown: boolean
}

const DEBOUNCE_MS = 350
/** Changes that never stop (an editor rebuilding its cache) still get reported this often. */
const MAX_WAIT_MS = 2000
const entries = new Map<string, Entry>()
const LOCK_POLL_MS = 250
const MAX_LOCK_WAIT_MS = 60_000

/** `.git/index.lock`, or that of the git folder a `.git` file points to (worktrees, submodules). */
function indexLockPath(repo: string): string {
  const dotGit = join(repo, '.git')
  try {
    if (statSync(dotGit).isFile()) {
      const target = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
      if (target) return join(resolve(repo, target), 'index.lock')
    }
  } catch {
    // no .git yet: the plain layout
  }
  return join(dotGit, 'index.lock')
}

/** The paths git ignores, of those given (paths go through stdin: 20 000 of them take under half a second). */
async function ignoredAmong(repo: string, paths: string[]): Promise<Set<string>> {
  const out = await git(['check-ignore', '-z', '--stdin'], { cwd: repo, input: paths.join('\0'), okCodes: [0, 1] })
  return new Set(out.stdout.split('\0').filter(Boolean))
}

/** Classifies a changed path; `null` means "ignore". */
export function classifyChange(filename: string | null): RepoChangedEvent['kind'] | null {
  if (!filename) return 'git'
  const file = filename.replace(/\\/g, '/')
  if (file === '.git') return 'git'
  if (file.startsWith('.git/')) {
    if (file === '.git/objects' || file === '.git/logs') return null
    if (file.startsWith('.git/objects/') || file.startsWith('.git/logs/') || file.endsWith('.lock')) return null
    return 'git'
  }
  return 'workdir'
}

/**
 * Whether git ignores every one of these paths (e.g. Unity's `Library/` while the editor works): then nothing the
 * app shows changed. Tracked files inside ignored folders are not ignored.
 */
export async function allIgnored(repo: string, paths: string[]): Promise<boolean> {
  if (!paths.length) return false
  try {
    const unique = [...new Set(paths)]
    const ignored = await ignoredAmong(repo, unique)
    const rest = unique.filter((p) => !ignored.has(p))
    if (!rest.length) return true
    // Folder patterns (`/Library/`) only match a folder's own path when git is told it is one.
    const folders: string[] = []
    for (const p of rest) {
      const isDir = await fs.lstat(join(repo, p)).then(
        (s) => s.isDirectory(),
        () => false
      )
      if (!isDir) return false
      folders.push(`${p}/`)
    }
    const ignoredFolders = await ignoredAmong(repo, folders)
    return folders.every((p) => ignoredFolders.has(p))
  } catch {
    return false
  }
}

export function watchRepo(repo: string, notify: (e: RepoChangedEvent) => void): void {
  if (entries.has(repo)) return
  let watcher: FSWatcher
  try {
    watcher = watch(repo, { recursive: true })
  } catch {
    return // Watching is best-effort; the UI also refreshes on focus.
  }
  const entry: Entry = { watcher, timer: null, kind: null, paths: new Set(), since: 0, unknown: false }

  const lock = indexLockPath(repo)
  let lockSince: number | null = null

  const flush = async () => {
    // While git writes files (a pull, a checkout, LFS downloads) it holds the index lock: a refresh now would show
    // its half-done work as changes. Wait for it, unless the lock is so old a crashed git most likely left it.
    if (existsSync(lock)) {
      const now = Date.now()
      lockSince ??= now
      if (now - lockSince < MAX_LOCK_WAIT_MS) {
        entry.timer = setTimeout(() => void flush(), LOCK_POLL_MS)
        return
      }
    } else lockSince = null
    const kind = entry.kind ?? 'workdir'
    const paths = [...entry.paths]
    entry.kind = null
    entry.timer = null
    entry.paths = new Set()
    entry.unknown = false
    if (kind === 'workdir' && (await allIgnored(repo, paths))) return
    if (entries.get(repo) === entry) notify({ repo, kind })
  }

  watcher.on('change', (_event, filename) => {
    const name = typeof filename === 'string' ? filename : (filename?.toString() ?? null)
    const kind = classifyChange(name)
    if (!kind) return
    if (kind === 'workdir' && name) entry.paths.add(name.replace(/\\/g, '/'))
    if (!name) entry.unknown = true
    entry.kind = entry.kind === 'git' || kind === 'git' ? 'git' : 'workdir'
    const now = Date.now()
    if (entry.timer) clearTimeout(entry.timer)
    else entry.since = now
    const wait = entry.unknown ? DEBOUNCE_MS : Math.max(0, Math.min(DEBOUNCE_MS, entry.since + MAX_WAIT_MS - now))
    entry.timer = setTimeout(() => void flush(), wait)
  })
  watcher.on('error', () => unwatchRepo(repo))
  entries.set(repo, entry)
}

export function unwatchRepo(repo: string): void {
  const entry = entries.get(repo)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.watcher.close()
  entries.delete(repo)
}

export function unwatchAll(): void {
  for (const repo of [...entries.keys()]) unwatchRepo(repo)
}
