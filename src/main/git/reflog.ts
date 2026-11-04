import { parseReflog, REFLOG_FORMAT, REFLOG_MAX, type Reflog } from '../../shared/reflog'
import { git } from './runner'

/**
 * Where HEAD has been, newest first (at most `limit` entries): each commit made, checked out, reset to or rebased
 * onto. Entries whose commit is on no branch, tag or remote branch are `lost`: the reflog is the only way back to them.
 */
export async function getReflog(repo: string, limit = REFLOG_MAX): Promise<Reflog> {
  const head = await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repo, okCodes: [0, 1] })
  // No commit yet: nothing to list.
  if (head.exitCode !== 0) return { entries: [], more: false }
  const out = await git(
    ['log', '-g', '--date=unix', `--max-count=${limit + 1}`, `--format=${REFLOG_FORMAT}`, 'HEAD', '--'],
    { cwd: repo }
  )
  const all = parseReflog(out.stdout)
  const entries = all.slice(0, limit)
  const hashes = [...new Set(entries.map((e) => e.hash))]
  let lost = new Set<string>()
  if (hashes.length) {
    // Those listed that no ref leads to, nor HEAD (refs of the app's own, like review mirrors, do not count).
    const unreachable = await git(['rev-list', '--stdin', '--not', '--branches', '--tags', '--remotes', 'HEAD'], {
      cwd: repo,
      input: hashes.join('\n') + '\n'
    })
    lost = new Set(unreachable.stdout.split('\n').map((l) => l.trim()))
  }
  return { entries: entries.map((e) => ({ ...e, lost: lost.has(e.hash) })), more: all.length > limit }
}
