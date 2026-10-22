import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearReleaseNotesCache, fetchReleaseNotes } from '../src/main/releaseNotes'

const answer = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json })
const releases = [{ tag_name: 'v0.8.1', published_at: '2026-10-22T13:40:00Z', prerelease: true, body: '- A fix.' }]

beforeEach(() => clearReleaseNotesCache())

describe('fetchReleaseNotes', () => {
  it("reads the project's releases from GitHub, and keeps them a few minutes", async () => {
    const fetchFn = vi.fn(async () => answer(200, releases))
    const now = 1_000_000
    expect((await fetchReleaseNotes(fetchFn, now)).map((n) => n.version)).toEqual(['0.8.1'])
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/Galderolo/Leviathan/releases?per_page=100',
      expect.anything()
    )
    await fetchReleaseNotes(fetchFn, now + 5 * 60_000)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await fetchReleaseNotes(fetchFn, now + 11 * 60_000)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('fails when GitHub says no (e.g. the hourly limit), so the app shows its own notes', async () => {
    await expect(fetchReleaseNotes(async () => answer(403, { message: 'rate limit' }))).rejects.toThrow(/403/)
  })
})
