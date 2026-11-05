/** A bisect under way (`git bisect`): the commits marked so far, and what is left to test. */
export interface BisectState {
  /** What it started from (a branch name, or a commit): finishing goes back there. */
  start: string
  /** The words git takes for a bad and a good commit (`bad`/`good` unless started with other terms). */
  terms: { bad: string; good: string }
  /** The commit marked bad (the newest one known to have the problem), null until one is. */
  bad: string | null
  good: string[]
  skipped: string[]
  /** Commits left to test after the one checked out, and roughly how many steps that is, as git works them out. */
  left: number | null
  steps: number | null
  /** Found: the first commit with the problem. */
  firstBad: string | null
  /** Only skipped commits are left: the first bad one is one of these (the bad commit among them). */
  suspects: string[] | null
  /**
   * A commit marked good comes after the one marked bad (the bad one is part of its history): there is nothing between
   * them to test, and git cannot go on until another commit is marked bad, or it stops.
   */
  crossed: boolean
}

export type BisectMark = 'good' | 'bad' | 'skip'

/** `git rev-list --bisect-vars` (`bisect_nr=3`...): what is left to test. */
export function parseBisectVars(out: string): { rev: string | null; left: number; steps: number; all: number } {
  const vars = new Map<string, string>()
  for (const line of out.split('\n')) {
    const match = /^(bisect_\w+)=(.*)$/.exec(line.trim())
    if (match) vars.set(match[1], match[2].replace(/^'(.*)'$/, '$1'))
  }
  const num = (key: string) => Number(vars.get(key) ?? 0) || 0
  return {
    rev: vars.get('bisect_rev') || null,
    left: num('bisect_nr'),
    steps: num('bisect_steps'),
    all: num('bisect_all')
  }
}

/** `BISECT_TERMS`: the bad word, then the good one. */
export function parseBisectTerms(text: string): { bad: string; good: string } {
  const [bad, good] = text.split('\n').map((l) => l.trim())
  return bad && good ? { bad, good } : { bad: 'bad', good: 'good' }
}

/** `git for-each-ref --format='%(objectname) %(refname)' refs/bisect/` by what each ref marks. */
export function parseBisectRefs(
  out: string,
  terms: { bad: string; good: string }
): { bad: string | null; good: string[]; skipped: string[] } {
  let bad: string | null = null
  const good: string[] = []
  const skipped: string[] = []
  for (const line of out.split('\n')) {
    const [hash, ref] = line.trim().split(' ')
    if (!hash || !ref) continue
    const name = ref.replace(/^refs\/bisect\//, '')
    if (name === terms.bad) bad = hash
    else if (name.startsWith(`${terms.good}-`)) good.push(hash)
    else if (name.startsWith('skip-')) skipped.push(hash)
  }
  return { bad, good, skipped }
}

/** How each marked commit shows in the graph: the one found, the bad and good ones, the skipped ones. */
export function bisectMarks(state: BisectState | null): Map<string, 'first' | BisectMark> {
  const marks = new Map<string, 'first' | BisectMark>()
  if (!state) return marks
  for (const hash of state.skipped) marks.set(hash, 'skip')
  for (const hash of state.good) marks.set(hash, 'good')
  if (state.bad) marks.set(state.bad, state.firstBad === state.bad ? 'first' : 'bad')
  return marks
}
