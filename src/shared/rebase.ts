export const REBASE_ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'] as const
export type RebaseAction = (typeof REBASE_ACTIONS)[number]

/** One commit of an interactive rebase, in the order it is applied (oldest first). */
export interface RebaseItem {
  hash: string
  action: RebaseAction
  /** New message, for `reword`. */
  message?: string
}

export type RebaseProblem = 'empty' | 'noBase' | 'noMessage'

/** Why the list cannot be run as is, or null when it can. */
export function rebaseProblem(items: RebaseItem[]): RebaseProblem | null {
  const kept = items.filter((i) => i.action !== 'drop')
  if (!kept.length) return 'empty'
  // squash/fixup meld into the commit before them; the first one left has none.
  if (kept[0].action === 'squash' || kept[0].action === 'fixup') return 'noBase'
  if (kept.some((i) => i.action === 'reword' && !i.message?.trim())) return 'noMessage'
  return null
}

/** Quotes a string for sh (the shell git runs editors and `exec` lines with). */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** A todo list for `git rebase -i` and the files its `exec` lines read, by name. */
export interface RebasePlan {
  todo: string
  files: Record<string, string>
}

/**
 * Plans `git rebase -i` so that no editor ever opens: a commit and the squash /
 * fixup commits melded into it are picked and fixed up, then one amend sets the
 * group's message (new for a reword, joined for squashes) from a file. The amend
 * runs only if the group's own commit was made — when it ends up empty git drops
 * it, and the amend would otherwise rename the commit before it. Markers and
 * messages live at `path(name)`, so they still apply after a stop for a conflict.
 */
export function planRebase(
  items: RebaseItem[],
  messageOf: (hash: string) => string,
  path: (name: string) => string
): RebasePlan {
  interface Group {
    head: number
    last: number
    parts: string[]
    amend: boolean
  }
  const groups: Group[] = []
  items.forEach((item, index) => {
    if (item.action === 'drop') return
    if (item.action === 'pick' || item.action === 'reword') {
      const reword = item.action === 'reword'
      groups.push({
        head: index,
        last: index,
        parts: [reword ? (item.message ?? '') : messageOf(item.hash)],
        amend: reword
      })
      return
    }
    // rebaseProblem guarantees a commit to meld into.
    const group = groups[groups.length - 1]
    group.last = index
    if (item.action === 'squash') {
      group.parts.push(messageOf(item.hash))
      group.amend = true
    }
  })

  const lines: string[] = []
  const files: Record<string, string> = {}
  const q = (name: string) => shQuote(path(name))
  items.forEach((item, index) => {
    const group = groups.find((g) => g.head === index)
    if (item.action === 'drop') lines.push(`drop ${item.hash}`)
    else if (!group) lines.push(`fixup ${item.hash}`)
    else if (!group.amend) lines.push(`pick ${item.hash}`)
    else {
      lines.push(`exec git rev-parse HEAD > ${q(`before-${index}`)}`)
      lines.push(`pick ${item.hash}`)
      lines.push(`exec git rev-parse HEAD > ${q(`after-${index}`)}`)
    }
    const ending = groups.find((g) => g.last === index && g.amend)
    if (ending) {
      const i = ending.head
      files[`msg-${i}`] = ending.parts.join('\n\n')
      lines.push(
        `exec if [ "$(cat ${q(`after-${i}`)})" != "$(cat ${q(`before-${i}`)})" ]; then ` +
          `git commit --amend --allow-empty --no-verify -q --cleanup=whitespace -F ${q(`msg-${i}`)}; fi`
      )
    }
  })
  return { todo: lines.join('\n') + '\n', files }
}
