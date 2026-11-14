import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pendingFixup, type FixupInfo, type FixupRefusal } from '../../shared/fixup'
import { assertSafeArg, currentOperation, gitDir, run } from './repository'
import { git } from './runner'

/** What a fixup into a commit rewrites. */
interface FixupPlan {
  /** The commit, as a full hash. */
  target: string
  subject: string
  /** What `rev-list` walks for the commits rewritten: from the commit before `target` (all of HEAD for a root). */
  range: string[]
  /** The commit before `target`; null for a root commit. */
  base: string | null
}

async function count(repo: string, revs: string[]): Promise<number> {
  return Number((await run(repo, ['rev-list', '--count', ...revs, '--'])).trim())
}

/** What adding the staged changes to `target` rewrites, or why it cannot be done now. */
async function planFixup(repo: string, target: string): Promise<FixupPlan | FixupRefusal> {
  assertSafeArg(target, 'commit')
  // A bisect has HEAD on a commit to test: rewriting the branch under it would lose its way.
  if ((await currentOperation(repo)) || existsSync(join(await gitDir(repo), 'BISECT_START'))) return 'operation'
  if ((await git(['diff', '--cached', '--quiet'], { cwd: repo, okCodes: [0, 1] })).exitCode === 0) return 'nothingStaged'
  const found = await git(['rev-parse', '--verify', '--quiet', `${target}^{commit}`], { cwd: repo, okCodes: [0, 1] })
  const hash = found.stdout.trim()
  if (!hash) return 'notAncestor'
  const ancestor = await git(['merge-base', '--is-ancestor', hash, 'HEAD'], { cwd: repo, okCodes: [0, 1] })
  if (ancestor.exitCode !== 0) return 'notAncestor'
  const [, base = null] = (await run(repo, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ')
  const range = base ? [`${base}..HEAD`] : ['HEAD']
  if ((await run(repo, ['rev-list', '--merges', ...range, '--'])).trim()) return 'merges'
  // Autosquash would meld those as well, into their own targets.
  if (pendingFixup((await run(repo, ['log', '--format=%s', ...range, '--'])).split('\n'))) return 'pendingFixups'
  const subject = (await run(repo, ['log', '-1', '--format=%s', hash, '--'])).trim()
  return { target: hash, subject, range, base }
}

/**
 * Whether what is staged can be added to `target` now. `published`: how many of the commits rewritten (`target` and
 * those after it) are on a remote, which pushing them again then needs Force push for. `RepoState.unpushed` does not
 * tell: it stops at 500 commits and is empty without remotes.
 */
export async function fixupInfo(repo: string, target: string): Promise<FixupInfo> {
  const plan = await planFixup(repo, target)
  if (typeof plan === 'string') return { ok: false, reason: plan }
  const published = (await count(repo, plan.range)) - (await count(repo, [...plan.range, '--not', '--remotes']))
  return { ok: true, subject: plan.subject, published }
}
