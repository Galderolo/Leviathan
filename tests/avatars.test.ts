import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AvatarCache, avatarSources, type ImageFetch } from '../src/main/avatars'
import type { Account } from '../src/shared/types'

const ana: Account = {
  id: 'a1',
  provider: 'github',
  host: 'github.com',
  username: 'AnaDev',
  name: 'Ana',
  email: 'ana@studio.example'
}
const gravatar = (email: string) =>
  `https://gravatar.com/avatar/${createHash('sha256').update(email).digest('hex')}?s=64&d=404`

/** Serves a small "image" for the URLs in `images`, 404 for the rest; counts requests. */
function fakeImages(images: string[]) {
  const asked: string[] = []
  const fn: ImageFetch = async (url) => {
    asked.push(url)
    const found = images.includes(url)
    return {
      ok: found,
      status: found ? 200 : 404,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' && found ? 'image/png' : null) },
      arrayBuffer: async () => new TextEncoder().encode(`png of ${url}`).buffer as ArrayBuffer
    }
  }
  return { fn, asked }
}
const dataUrl = (url: string) => `data:image/png;base64,${Buffer.from(`png of ${url}`).toString('base64')}`

describe('avatarSources', () => {
  it("takes GitHub's picture for its no-reply emails, without asking its API", () => {
    expect(avatarSources('12345+ana@users.noreply.github.com', [])[0]).toBe(
      'https://avatars.githubusercontent.com/u/12345?s=64'
    )
    expect(avatarSources('ana@users.noreply.github.com', [])[0]).toBe('https://github.com/ana.png?size=64')
  })

  it("takes the picture of the user's own GitHub account for its email, and Gravatar's last", () => {
    expect(avatarSources(' Ana@Studio.example ', [ana])).toEqual([
      'https://github.com/AnaDev.png?size=64',
      gravatar('ana@studio.example')
    ])
    expect(avatarSources('bo@example.com', [ana])).toEqual([gravatar('bo@example.com')])
  })
})

describe('AvatarCache', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leviathan-avatars-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('fetches each picture once, from the first source that has one, and remembers who has none', async () => {
    const images = fakeImages([gravatar('bo@example.com'), 'https://github.com/AnaDev.png?size=64'])
    const cache = new AvatarCache(join(dir, 'avatars.json'), images.fn)
    const people = [{ email: 'ana@studio.example' }, { email: 'Bo@example.com' }, { email: 'cy@example.com' }]
    const found = await cache.get(people, { accounts: [ana] })
    expect(found).toEqual({
      'ana@studio.example': dataUrl('https://github.com/AnaDev.png?size=64'),
      'bo@example.com': dataUrl(gravatar('bo@example.com')),
      'cy@example.com': null
    })
    const asked = images.asked.length
    // Asked again, even by a new cache reading the same file: nothing is fetched.
    expect(await cache.get(people, { accounts: [ana] })).toEqual(found)
    expect(await new AvatarCache(join(dir, 'avatars.json'), images.fn).get(people, { accounts: [ana] })).toEqual(found)
    expect(images.asked.length).toBe(asked)
    expect(existsSync(join(dir, 'avatars.json'))).toBe(true)
  })

  it("asks the repository's server who wrote a commit, before Gravatar", async () => {
    const images = fakeImages(['https://avatars.githubusercontent.com/u/7?v=4&s=64'])
    const cache = new AvatarCache(join(dir, 'avatars.json'), images.fn)
    const byCommit: string[] = []
    const found = await cache.get([{ email: 'dee@work.example', hash: 'abc123' }], {
      accounts: [],
      commitAvatar: async (hash) => {
        byCommit.push(hash)
        return 'https://avatars.githubusercontent.com/u/7?v=4'
      }
    })
    expect(byCommit).toEqual(['abc123'])
    expect(found['dee@work.example']).toBe(dataUrl('https://avatars.githubusercontent.com/u/7?v=4&s=64'))
  })

  it('does not remember a failure to reach a server, only that there is no picture', async () => {
    let calls = 0
    const down: ImageFetch = async () => {
      calls++
      throw new Error('offline')
    }
    const cache = new AvatarCache(join(dir, 'avatars.json'), down)
    expect(await cache.get([{ email: 'bo@example.com' }], { accounts: [] })).toEqual({ 'bo@example.com': null })
    await cache.get([{ email: 'bo@example.com' }], { accounts: [] })
    expect(calls).toBe(2)
  })
})
