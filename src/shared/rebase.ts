export const REBASE_ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'] as const
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
    if (item.action === 'pick' || item.action === 'reword' || item.action === 'edit') {
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
    // `edit` stops after applying the commit so the user can change it; the rest goes on with continue.
    else if (!group.amend) lines.push(`${item.action === 'edit' ? 'edit' : 'pick'} ${item.hash}`)
    else {
      lines.push(`exec git rev-parse HEAD > ${q(`before-${index}`)}`)
      lines.push(`${item.action === 'edit' ? 'edit' : 'pick'} ${item.hash}`)
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

/**
 * A line of the list `git rebase -i --rebase-merges` makes: one of its commits, a merge (kept as it is), or a line that
 * keeps the branches apart (`label`, `reset`).
 */
export type ScriptLine =
  { kind: 'pick'; hash: string } | { kind: 'merge'; subject: string; text: string } | { kind: 'other'; text: string }

/** Reads git's own list, its abbreviated hashes taken as the full ones of `commits`; comments and blanks go. */
export function parseRebaseScript(todo: string, commits: { hash: string }[]): ScriptLine[] {
  const lines: ScriptLine[] = []
  for (const raw of todo.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const pick = /^(?:pick|p) ([0-9a-f]+)/.exec(line)
    if (pick) {
      const commit = commits.find((c) => c.hash.startsWith(pick[1]))
      if (!commit) throw new Error(`The rebase list names a commit that is not among the ones read: ${pick[1]}`)
      lines.push({ kind: 'pick', hash: commit.hash })
    } else if (/^(?:merge|m) /.test(line)) {
      const comment = line.indexOf(' # ')
      lines.push({ kind: 'merge', subject: comment < 0 ? '' : line.slice(comment + 3), text: line })
    } else lines.push({ kind: 'other', text: line })
  }
  return lines
}

/** The commits between the lines that keep the branches apart: a squash or fixup melds only into one of its own. */
function segments(lines: ScriptLine[], items: RebaseItem[]): RebaseItem[][] {
  const byHash = new Map(items.map((item) => [item.hash, item]))
  const out: RebaseItem[][] = [[]]
  for (const line of lines) {
    if (line.kind === 'pick') out[out.length - 1].push(byHash.get(line.hash) ?? { hash: line.hash, action: 'pick' })
    else if (out[out.length - 1].length) out.push([])
  }
  return out.filter((segment) => segment.length)
}

/** Why the list cannot be run as is (with merges), or null when it can. */
export function rebaseProblemWithMerges(lines: ScriptLine[], items: RebaseItem[]): RebaseProblem | null {
  if (!items.some((i) => i.action !== 'drop')) return 'empty'
  for (const segment of segments(lines, items)) {
    const problem = rebaseProblem(segment)
    if (problem && problem !== 'empty') return problem
  }
  return null
}

/**
 * Plans a rebase that keeps merges: git's own list, with each run of a branch's commits planned as `planRebase` plans
 * a whole rebase (its helper files named apart), and its labels, resets and merges as they were.
 */
export function planRebaseWithMerges(
  lines: ScriptLine[],
  items: RebaseItem[],
  messageOf: (hash: string) => string,
  path: (name: string) => string
): RebasePlan {
  const byHash = new Map(items.map((item) => [item.hash, item]))
  const todo: string[] = []
  const files: Record<string, string> = {}
  let run: RebaseItem[] = []
  let count = 0
  const flush = () => {
    if (!run.length) return
    const prefix = `s${count++}-`
    const plan = planRebase(run, messageOf, (name) => path(prefix + name))
    todo.push(...plan.todo.split('\n').filter(Boolean))
    for (const [name, text] of Object.entries(plan.files)) files[prefix + name] = text
    run = []
  }
  for (const line of lines) {
    if (line.kind === 'pick') {
      run.push(byHash.get(line.hash) ?? { hash: line.hash, action: 'pick' })
      continue
    }
    flush()
    todo.push(line.text)
  }
  flush()
  return { todo: todo.join('\n') + '\n', files }
}

/** `items` with the one at `from` moved to `to` (a drag and drop); out-of-range moves change nothing. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
