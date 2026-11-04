/** One move of HEAD, as git's reflog recorded it: newest first, `index` is the n of `HEAD@{n}`. */
export interface ReflogEntry {
  index: number
  /** The commit HEAD pointed at after the move. */
  hash: string
  /** Unix time (seconds) of the move. */
  date: number
  /** What moved it, as git tells: `commit`, `commit (amend)`, `checkout`, `reset`, `rebase (finish)`... */
  action: string
  /** git's words after the action: `moving from main to feature`, or the subject of the commit made. */
  detail: string
  /** The subject of the commit HEAD pointed at. */
  subject: string
  /** The commit is on no branch, tag or remote branch any more (and HEAD is not on it): it is only kept here. */
  lost: boolean
}

export interface Reflog {
  entries: ReflogEntry[]
  /** There are older entries than those listed. */
  more: boolean
}

/** Entries read at most. */
export const REFLOG_MAX = 500

export const REFLOG_FORMAT = '%H%x1f%gd%x1f%gs%x1f%s%x1e'

/** `git log -g --date=unix --format=REFLOG_FORMAT` (selectors as `HEAD@{<time>}`), without `lost` worked out. */
export function parseReflog(out: string): Omit<ReflogEntry, 'lost'>[] {
  const entries: Omit<ReflogEntry, 'lost'>[] = []
  for (const record of out.split('\x1e')) {
    const fields = record.replace(/^\s+/, '').split('\x1f')
    if (fields.length < 4 || !/^[0-9a-f]{40,64}$/.test(fields[0])) continue
    const [hash, selector, message, subject] = fields
    const time = /@\{(\d+)\}$/.exec(selector)
    const colon = message.indexOf(': ')
    entries.push({
      index: entries.length,
      hash,
      date: time ? Number(time[1]) : 0,
      action: colon >= 0 ? message.slice(0, colon) : message,
      detail: colon >= 0 ? message.slice(colon + 2) : '',
      subject: subject.replace(/\s+$/, '')
    })
  }
  return entries
}

export type ReflogKind =
  'commit' | 'amend' | 'checkout' | 'reset' | 'rebase' | 'merge' | 'pull' | 'cherry-pick' | 'revert' | 'clone' | 'other'

/** The kind of move an entry's action names, to label it: `commit (amend)` is an amend, `rebase -i (finish)` a rebase. */
export function reflogKind(action: string): ReflogKind {
  const word = action.trim().split(/[\s(]/)[0].toLowerCase()
  if (word === 'commit') return /\(amend\)/.test(action) ? 'amend' : 'commit'
  if (word === 'switch') return 'checkout'
  const known: ReflogKind[] = ['checkout', 'reset', 'rebase', 'merge', 'pull', 'cherry-pick', 'revert', 'clone']
  return known.includes(word as ReflogKind) ? (word as ReflogKind) : 'other'
}
