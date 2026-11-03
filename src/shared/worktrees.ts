/** A folder of the repository with a branch (or a commit) of its own checked out: git's worktrees. */
export interface Worktree {
  path: string
  head: string | null
  /** The branch checked out there; null for a detached HEAD. */
  branch: string | null
  /** The repository's own folder (git lists it first). */
  main: boolean
  /** The folder this repository is open from. */
  current: boolean
  locked: boolean
  /** Its folder is gone (deleted by hand): `git worktree prune` forgets it. */
  prunable: boolean
}

/** A folder next to the repository's for a worktree of `branch`: `D:\Game` and `feature/ui` give `D:\Game-feature-ui`. */
export function worktreeFolder(repo: string, branch: string): string {
  return `${repo.replace(/[\\/]+$/, '')}-${branch.replace(/[\\/:*?"<>|\s]+/g, '-')}`
}

/** `git worktree list --porcelain`: one block per worktree, the main one first. */
export function parseWorktrees(out: string): Omit<Worktree, 'current'>[] {
  const list: Omit<Worktree, 'current'>[] = []
  let current: Omit<Worktree, 'current'> | null = null
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('worktree ')) {
      current = {
        path: line.slice(9),
        head: null,
        branch: null,
        main: list.length === 0,
        locked: false,
        prunable: false
      }
      list.push(current)
    } else if (!current) continue
    else if (line.startsWith('HEAD ')) current.head = line.slice(5)
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true
  }
  return list
}
