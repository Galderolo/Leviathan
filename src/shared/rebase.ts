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

/**
 * The todo list for `git rebase -i`. A reword is a pick followed by an amend that
 * reads the new message from `messageFile(index)`, so no editor is ever opened
 * and it still applies after the rebase stops for a conflict.
 */
export function buildTodo(items: RebaseItem[], messageFile: (index: number) => string): string {
  const lines: string[] = []
  items.forEach((item, index) => {
    if (item.action !== 'reword') {
      lines.push(`${item.action} ${item.hash}`)
      return
    }
    lines.push(`pick ${item.hash}`)
    lines.push(`exec git commit --amend --allow-empty --no-verify -q -F ${shQuote(messageFile(index))}`)
  })
  return lines.join('\n') + '\n'
}
