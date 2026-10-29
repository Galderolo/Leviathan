/** What stopped a checkout: uncommitted changes in its way. Git refused it and changed nothing. */
export interface CheckoutBlock {
  /** Git's own message, for when nothing else can be done. */
  message: string
  /** Tracked files whose uncommitted changes (staged or not) the checkout would overwrite. */
  changed: string[]
  /** Untracked files the checkout would overwrite or remove. */
  untracked: string[]
  /** Folders whose untracked files would be lost (the other side has a file there). */
  folders: string[]
}

// The headings git (in English) puts above each list of files, one tab before each name.
const HEADINGS: [RegExp, 'changed' | 'untracked' | 'folders'][] = [
  [/Your local changes to the following files would be overwritten by checkout:$/, 'changed'],
  [/The following untracked working tree files would be (overwritten|removed) by checkout:$/, 'untracked'],
  [/Updating the following directories would lose untracked files in them:$/, 'folders']
]

/** The files of git's refusal to check out over uncommitted changes, or null when it failed for another reason. */
export function parseCheckoutBlock(stderr: string): Omit<CheckoutBlock, 'message'> | null {
  const found = { changed: [] as string[], untracked: [] as string[], folders: [] as string[] }
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
    any ||= !!heading
  }
  return any ? found : null
}
