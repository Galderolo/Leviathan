import { type FSWatcher, watch } from 'node:fs'
import type { RepoChangedEvent } from '../shared/types'

interface Entry {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
  kind: RepoChangedEvent['kind'] | null
}

const DEBOUNCE_MS = 350
const entries = new Map<string, Entry>()

/** Classifies a changed path; `null` means "ignore". */
export function classifyChange(filename: string | null): RepoChangedEvent['kind'] | null {
  if (!filename) return 'git'
  const file = filename.replace(/\\/g, '/')
  if (file === '.git') return 'git'
  if (file.startsWith('.git/')) {
    if (file.startsWith('.git/objects/') || file.startsWith('.git/logs/') || file.endsWith('.lock')) return null
    return 'git'
  }
  return 'workdir'
}

export function watchRepo(repo: string, notify: (e: RepoChangedEvent) => void): void {
  if (entries.has(repo)) return
  let watcher: FSWatcher
  try {
    watcher = watch(repo, { recursive: true })
  } catch {
    return // Watching is best-effort; the UI also refreshes on focus.
  }
  const entry: Entry = { watcher, timer: null, kind: null }
  watcher.on('change', (_event, filename) => {
    const kind = classifyChange(typeof filename === 'string' ? filename : (filename?.toString() ?? null))
    if (!kind) return
    entry.kind = entry.kind === 'git' || kind === 'git' ? 'git' : 'workdir'
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      const k = entry.kind ?? 'workdir'
      entry.kind = null
      entry.timer = null
      notify({ repo, kind: k })
    }, DEBOUNCE_MS)
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
