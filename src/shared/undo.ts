/** Where HEAD points: a branch (with its tip) or a detached commit. */
export interface HeadState {
  branch: string | null
  hash: string | null
  /** Commits being merged (MERGE_HEAD) while a merge is in progress. */
  merge?: string[]
}

/** A branch's own settings (`branch.<name>.<key>`), as [key, value] pairs. */
export type BranchConfig = [string, string][]

/** Every local branch and tag (full ref name -> object id) plus HEAD. */
export interface Snapshot {
  head: HeadState
  refs: Record<string, string>
  /** Settings of local branches, by branch name. */
  config?: Record<string, BranchConfig>
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
}

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
  if (!refs.length && !headChanged) return null
  return { refs, head: { from: { ...before.head }, to: { ...after.head } }, mode }
}

export function invertChange(change: RepoChange): RepoChange {
  return {
    refs: change.refs.map((m) => ({ ...m, from: m.to, to: m.from })),
    head: { from: { ...change.head.to }, to: { ...change.head.from } },
    mode: change.mode
  }
}
