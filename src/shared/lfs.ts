/** Staged files over this size that do not go through LFS get a warning (GitHub warns at 50 MB, rejects 100 MB). */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024

/** A pattern sent through Git LFS by a `.gitattributes` file. */
export interface LfsPattern {
  /** As written in the attributes file (relative to its folder). */
  pattern: string
  /** Files must be locked before editing them (read-only otherwise). */
  lockable: boolean
  /** Repository-relative path of the attributes file, `/`-separated. */
  source: string
}

/** A file locked on the LFS server. */
export interface LfsLock {
  id: string
  path: string
  owner: string
  /** ISO date. */
  lockedAt: string
  /** Whether it is the user's own lock; null when the server cannot tell. */
  mine: boolean | null
}

export interface LfsInfo {
  /** Installed git-lfs version, or null when git-lfs is missing. */
  version: string | null
  /** Some attributes file sends files through LFS. */
  used: boolean
  /** The LFS filters are configured: files are stored as pointers and downloaded on checkout. */
  filters: boolean
  /** The repository has the LFS hooks, which upload LFS files on push. */
  hooks: boolean
  patterns: LfsPattern[]
}

/** Reads a C-style quoted pattern (`"my file.bin"`); returns it and the rest of the line. */
function readQuoted(line: string): [string, string] {
  let out = ''
  let i = 1
  for (; i < line.length && line[i] !== '"'; i++) {
    if (line[i] !== '\\') {
      out += line[i]
      continue
    }
    const next = line[++i]
    if (next === 't') out += '\t'
    else if (next === 'n') out += '\n'
    else if (next !== undefined) out += next
  }
  return [out, line.slice(i + 1)]
}

/** Attribute macros (`[attr]lfs filter=lfs diff=lfs …`): name → the attributes it stands for. */
export type AttributeMacros = Map<string, string[]>

/** Macros defined in an attributes file (git only honours those of the root `.gitattributes`). */
export function parseMacros(text: string): AttributeMacros {
  const macros: AttributeMacros = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('[attr]')) continue
    const [name, ...attrs] = line.slice('[attr]'.length).trim().split(/\s+/)
    if (name) macros.set(name, attrs)
  }
  return macros
}

/** The LFS patterns of one `.gitattributes` file; later lines for the same pattern override earlier ones. */
export function parseAttributes(text: string, source: string, macros: AttributeMacros = new Map()): LfsPattern[] {
  const seen = new Map<string, { lfs: boolean; lockable: boolean }>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('[attr]')) continue
    const [pattern, rest] = line.startsWith('"') ? readQuoted(line) : [line.split(/\s+/)[0], line.replace(/^\S+/, '')]
    if (!pattern) continue
    const entry = seen.get(pattern) ?? { lfs: false, lockable: false }
    const apply = (attr: string, expanding: Set<string>): void => {
      const name = attr.replace(/^[-!]/, '').split('=')[0]
      const unset = attr.startsWith('-') || attr.startsWith('!')
      const macro = attr.includes('=') ? undefined : macros.get(name)
      if (macro && !expanding.has(name)) {
        // Unsetting a macro unsets what it stands for; a macro that refers back to itself stops there.
        const inner = new Set(expanding).add(name)
        for (const a of macro) apply(unset ? '-' + a.replace(/^[-!]/, '').split('=')[0] : a, inner)
      } else if (name === 'filter') entry.lfs = !unset && attr === 'filter=lfs'
      else if (name === 'lockable') entry.lockable = !unset
    }
    for (const attr of rest.split(/\s+/).filter(Boolean)) apply(attr, new Set())
    seen.set(pattern, entry)
  }
  return [...seen].filter(([, e]) => e.lfs).map(([pattern, e]) => ({ pattern, lockable: e.lockable, source }))
}

function toLock(value: unknown, mine: boolean | null): LfsLock | null {
  const v = value as { id?: unknown; path?: unknown; owner?: { name?: unknown }; locked_at?: unknown } | null
  if (!v || typeof v.id !== 'string' || typeof v.path !== 'string') return null
  return {
    id: v.id,
    path: v.path,
    owner: typeof v.owner?.name === 'string' ? v.owner.name : '',
    lockedAt: typeof v.locked_at === 'string' ? v.locked_at : '',
    mine
  }
}

function toLocks(list: unknown, mine: boolean | null): LfsLock[] {
  if (!Array.isArray(list)) return []
  return list.map((l) => toLock(l, mine)).filter((l): l is LfsLock => l !== null)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Output of `git lfs locks --json`. */
export function parseLocks(json: string, mine: boolean | null): LfsLock[] {
  return toLocks(parseJson(json), mine)
}

/** Output of `git lfs locks --verify --json`: `ours` are the user's locks. */
export function parseVerifiedLocks(json: string): LfsLock[] {
  const v = parseJson(json) as { ours?: unknown; theirs?: unknown } | null
  if (!v || Array.isArray(v)) return []
  return [...toLocks(v.ours, true), ...toLocks(v.theirs, false)]
}

/** Pattern that sends a file through LFS: its extension (`*.psd`), or its own path when it has none. */
export function lfsPatternFor(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? `*${name.slice(dot)}` : path
}
