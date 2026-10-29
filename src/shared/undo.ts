/** Where HEAD points: a branch (with its tip) or a detached commit. */
export interface HeadState {
  branch: string | null
  hash: string | null
  /** Commits being merged (MERGE_HEAD) while a merge is in progress. */
  merge?: string[]
}

/** A branch's own settings (`branch.<name>.<key>`), as [key, value] pairs. */
export type BranchConfig = [string, string][]

/** A file as it was: its bytes in the working tree (a blob written for the purpose) and its index entry. */
export interface FileVersion {
  /** null: no such file. */
  worktree: string | null
  index: { mode: string; blob: string } | null
}

/** A stash: its commit and its line in the stash list. */
export interface StashEntry {
  commit: string
  message: string
}

/** Every local branch and tag (full ref name -> object id) plus HEAD. */
export interface Snapshot {
  head: HeadState
  refs: Record<string, string>
  /** Settings of local branches, by branch name. */
  config?: Record<string, BranchConfig>
  /** The files asked for (discarded, stashed…), by path. */
  files?: Record<string, FileVersion>
  /** Files asked for that were too large to keep a copy of: what changes them cannot be undone. */
  tooLarge?: string[]
  /** The stash list, newest first. */
  stash?: StashEntry[]
}

export interface FileMove {
  path: string
  from: FileVersion
  to: FileVersion
}

export interface RefMove {
  ref: string
  /** null: the ref did not exist */
  from: string | null
  /** null: the ref is deleted */
  to: string | null
  /** Settings of a branch that is created or deleted, restored when it comes back. */
  config?: BranchConfig
}

/**
 * What an operation changed, enough to apply it again or in reverse.
 * `mode` is how the checked-out branch moves: `soft` keeps the undone commit's
 * changes staged, `mixed` keeps them unstaged, `keep` updates the working tree
 * but never drops local changes.
 */
export interface RepoChange {
  refs: RefMove[]
  head: { from: HeadState; to: HeadState }
  mode: 'soft' | 'mixed' | 'keep'
  /** Files whose content changed (a discard, a stash saved or applied). */
  files?: FileMove[]
  /** Stashes that came (`added`) and went (`removed`). */
  stash?: { added: StashEntry[]; removed: StashEntry[] }
}

function sameVersion(a: FileVersion | undefined, b: FileVersion | undefined): boolean {
  return a?.worktree === b?.worktree && a?.index?.mode === b?.index?.mode && a?.index?.blob === b?.index?.blob
}

const NO_FILE: FileVersion = { worktree: null, index: null }

export function diffSnapshots(before: Snapshot, after: Snapshot, mode: RepoChange['mode']): RepoChange | null {
  const names = [...new Set([...Object.keys(before.refs), ...Object.keys(after.refs)])].sort()
  const refs: RefMove[] = []
  for (const ref of names) {
    const from = before.refs[ref] ?? null
    const to = after.refs[ref] ?? null
    if (from === to) continue
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null
    const config = branch && (from === null || to === null) ? (to === null ? before : after).config?.[branch] : null
    refs.push(config?.length ? { ref, from, to, config } : { ref, from, to })
  }
  const headChanged = before.head.branch !== after.head.branch || before.head.hash !== after.head.hash
  const paths = [...new Set([...Object.keys(before.files ?? {}), ...Object.keys(after.files ?? {})])].sort()
  const files: FileMove[] = paths
    .filter((path) => !sameVersion(before.files?.[path], after.files?.[path]))
    .map((path) => ({ path, from: before.files?.[path] ?? NO_FILE, to: after.files?.[path] ?? NO_FILE }))
  const kept = (list: StashEntry[] | undefined, other: StashEntry[] | undefined) =>
    (list ?? []).filter((s) => !(other ?? []).some((o) => o.commit === s.commit))
  const added = kept(after.stash, before.stash)
  const removed = kept(before.stash, after.stash)
  if (!refs.length && !headChanged && !files.length && !added.length && !removed.length) return null
  const change: RepoChange = { refs, head: { from: { ...before.head }, to: { ...after.head } }, mode }
  if (files.length) change.files = files
  if (added.length || removed.length) change.stash = { added, removed }
  return change
}

export function invertChange(change: RepoChange): RepoChange {
  const inverted: RepoChange = {
    refs: change.refs.map((m) => ({ ...m, from: m.to, to: m.from })),
    head: { from: { ...change.head.to }, to: { ...change.head.from } },
    mode: change.mode
  }
  if (change.files) inverted.files = change.files.map((f) => ({ path: f.path, from: f.to, to: f.from }))
  if (change.stash) inverted.stash = { added: change.stash.removed, removed: change.stash.added }
  return inverted
}
