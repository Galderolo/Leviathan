import { resolve } from 'node:path'
import { git } from './runner'

const FS = '\x1f'

// Everything `REF_FORMAT` has but the ahead/behind counts and the short upstream name, which take most of the
// time with many branches (git checks every short name against all refs to keep it unambiguous).
const BASE_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(upstream)',
  '%(HEAD)',
  '%(symref)',
  '%(creatordate:unix)'
].join('%1f')

/** Above this many branches to recompute, one call for all of them is cheaper than naming them. */
const BATCH = 200

interface Tracking {
  /** Tip of the branch and of its upstream when `track` was computed. */
  key: string
  track: string
}

const cache = new Map<string, Map<string, Tracking>>()

function repoKey(repo: string): string {
  const full = resolve(repo)
  return process.platform === 'win32' ? full.toLowerCase() : full
}

/** `origin/main` for `refs/remotes/origin/main`, `main` for a local upstream: the names the app gives those branches. */
export function shortUpstream(ref: string): string {
  return ref.replace(/^refs\/(remotes|heads)\//, '')
}

/** Branches whose ahead/behind must be computed again: new ones, or those whose tip or upstream moved. */
export function staleTracking(branches: { ref: string; key: string }[], known: Map<string, Tracking>): string[] {
  return branches.filter((b) => known.get(b.ref)?.key !== b.key).map((b) => b.ref)
}

/**
 * `for-each-ref` output in `REF_FORMAT`. Ahead/behind counts are remembered per branch and only computed
 * again for branches whose tip or upstream moved: a refresh after editing a file asks git for none of them.
 */
export async function listRefs(repo: string): Promise<string> {
  const env = { LC_ALL: 'C' }
  const out = await git(['for-each-ref', `--format=${BASE_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'], {
    cwd: repo,
    env
  })
  const rows = out.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.replace(/\r$/, '').split(FS))
  const hashes = new Map(rows.map(([ref, hash]) => [ref, hash]))
  const branches = rows
    .filter(([ref, , , upstream]) => ref.startsWith('refs/heads/') && upstream)
    .map(([ref, hash, , upstream]) => ({ ref, key: `${hash} ${hashes.get(upstream) ?? 'gone'}` }))

  const known = cache.get(repoKey(repo)) ?? new Map<string, Tracking>()
  const stale = staleTracking(branches, known)
  const fresh = new Map<string, string>()
  if (stale.length) {
    const patterns = stale.length > BATCH ? ['refs/heads'] : stale
    const track = await git(['for-each-ref', `--format=%(refname)${FS}%(upstream:track)`, ...patterns], {
      cwd: repo,
      env
    })
    for (const line of track.stdout.split('\n')) {
      const [ref, value] = line.replace(/\r$/, '').split(FS)
      if (ref) fresh.set(ref, value ?? '')
    }
  }
  const next = new Map<string, Tracking>()
  for (const b of branches) {
    next.set(b.ref, { key: b.key, track: fresh.get(b.ref) ?? known.get(b.ref)?.track ?? '' })
  }
  cache.set(repoKey(repo), next)

  return rows
    .map(([ref, hash, peeled, upstream, head, symref, created]) =>
      [ref, hash, peeled, shortUpstream(upstream), next.get(ref)?.track ?? '', head, symref, created].join(FS)
    )
    .join('\n')
}
