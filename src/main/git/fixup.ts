import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pendingFixup, type FixupInfo, type FixupRefusal } from '../../shared/fixup'
import { FIXUP_MARK, assertSafeArg, currentOperation, gitDir, run } from './repository'
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
  if ((await git(['diff', '--cached', '--quiet'], { cwd: repo, okCodes: [0, 1] })).exitCode === 0)
    return 'nothingStaged'
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

/** Why `fixupCommit` refuses (the renderer words its own, translated, from `fixupInfo`). */
const REFUSED: Record<FixupRefusal, string> = {
  operation: 'Finish or abort what is under way first.',
  nothingStaged: 'Nothing is staged.',
  notAncestor: 'That commit is not on the current branch.',
  merges: 'There are merges after that commit.',
  pendingFixups: 'There are fixup or squash commits after that commit.'
}

/**
 * Adds what is staged to `target`, a commit of the current branch, rewriting those after it: git's `commit --fixup`,
 * then `rebase -i --autosquash --autostash`, which sets the unstaged changes aside and brings them back. Gives the
 * commit `target` became. Stops, like any rebase, at a commit that does not apply cleanly; aborting it then leaves
 * everything as before (`abortOperation`). `noSign`: neither the fixup commit nor the rewritten ones are signed.
 */
export async function fixupCommit(repo: string, target: string, noSign = false): Promise<{ hash: string }> {
  const plan = await planFixup(repo, target)
  if (typeof plan === 'string') throw new Error(REFUSED[plan])
  const head = async () => (await run(repo, ['rev-parse', 'HEAD'])).trim()
  const before = await head()
  const after = await count(repo, [`${plan.target}..HEAD`])
  const sign = noSign ? ['--no-gpg-sign'] : []
  // Through the user's hooks and signing, as any commit; failing, it has changed nothing.
  await run(repo, ['commit', '-q', ...sign, `--fixup=${plan.target}`])
  const fixup = await head()
  try {
    await run(
      repo,
      ['rebase', '-i', '--autosquash', '--autostash', ...sign, ...(plan.base ? [plan.base] : ['--root'])],
      {
        // Over a `sequence.editor` of the user's, which would win over GIT_EDITOR: git's own list, as it is.
        env: { GIT_SEQUENCE_EDITOR: 'true' }
      }
    )
  } catch (err) {
    if (await currentOperation(repo)) {
      // Stopped part way. Git deletes its folder, and the mark with it, once the rebase is over however it ends.
      await fs.writeFile(join(await gitDir(repo), 'rebase-merge', FIXUP_MARK), `${fixup}\n`).catch(() => {})
    } else if ((await head()) === fixup) {
      // It did not start (a pre-rebase hook said no): the changes are staged again.
      await run(repo, ['reset', '--soft', '-q', before])
    }
    throw err
  }
  if ((await count(repo, plan.range)) !== after + 1) {
    // Autosquash matched nothing and kept the fixup commit as one of its own. The tree is the same: back as before.
    await run(repo, ['reset', '--soft', '-q', before])
    throw new Error('git could not add the changes to that commit.')
  }
  return { hash: (await run(repo, ['rev-parse', `HEAD~${after}`])).trim() }
}
