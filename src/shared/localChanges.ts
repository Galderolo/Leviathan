/**
 * What stopped a checkout, merge, pull, rebase, cherry-pick or revert: uncommitted changes in its way. Git refused it
 * and changed nothing.
 */
export interface ChangesBlock {
  /** Git's own message, for when nothing else can be done. */
  message: string
  /** Tracked files whose uncommitted changes (staged or not) it would overwrite. */
  changed: string[]
  /** Untracked files it would overwrite or remove. */
  untracked: string[]
  /** Folders whose untracked files would be lost (the other side has a file there). */
  folders: string[]
  /** Refused for any uncommitted change, naming no file (a rebase). */
  all: boolean
}

// The headings git (in English) puts above each list of files, one tab before each name.
const HEADINGS: [RegExp, 'changed' | 'untracked' | 'folders'][] = [
  [/Your local changes to the following files would be overwritten by (checkout|merge):$/, 'changed'],
  [/The following untracked working tree files would be (overwritten|removed) by (checkout|merge):$/, 'untracked'],
  [/Updating the following directories would lose untracked files in them:$/, 'folders']
]

/** A rebase (or a pull that rebases) refuses to start with any uncommitted change. */
const REFUSED_ALL =
  /^error: cannot (rebase|pull with rebase): (You have unstaged changes|Your index contains uncommitted changes)\./

/** What git's refusal over uncommitted changes names, or null when it failed for another reason. */
export function parseChangesBlock(stderr: string): Omit<ChangesBlock, 'message'> | null {
  const found = { changed: [] as string[], untracked: [] as string[], folders: [] as string[], all: false }
  let list: string[] | null = null
  let any = false
  for (const raw of stderr.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (list && line.startsWith('\t')) {
      list.push(line.slice(1))
      continue
    }
    const heading = HEADINGS.find(([pattern]) => pattern.test(line))
    list = heading ? found[heading[1]] : null
    if (REFUSED_ALL.test(line)) found.all = true
    any ||= !!heading || found.all
  }
  return any ? found : null
}
