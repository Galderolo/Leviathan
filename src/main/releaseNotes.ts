import { parseGithubReleases, type ReleaseNote } from '../shared/releaseNotes'
import { RELEASE_REPO } from '../shared/updates'

type Fetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** GitHub allows 60 requests an hour without signing in: notes are kept a few minutes. */
const CACHE_MS = 10 * 60_000
let cached: { at: number; notes: ReleaseNote[] } | null = null

export function clearReleaseNotesCache(): void {
  cached = null
}

/** The notes of every published release (pre-releases included), newest first. Throws when GitHub cannot be read. */
export async function fetchReleaseNotes(fetchFn: Fetch = fetch, now = Date.now()): Promise<ReleaseNote[]> {
  if (cached && now - cached.at < CACHE_MS) return cached.notes
  const { owner, repo } = RELEASE_REPO
  const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Leviathan' }
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const notes = parseGithubReleases(await res.json())
  cached = { at: now, notes }
  return notes
}
