import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Account } from '../shared/types'

export type ImageFetch = (url: string) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

/** Pixels asked for: twice the largest avatar drawn, for sharp screens. */
const SIZE = 64
const MAX_BYTES = 200 * 1024
const FOUND_FOR = 7 * 24 * 3600_000
const NONE_FOR = 24 * 3600_000
const AT_ONCE = 4

function sized(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}s=${SIZE}`
}

/**
 * Where a picture of the author of `email` may be, best first: GitHub's for its no-reply addresses and for the
 * emails of the user's own GitHub accounts (no API call), Gravatar's last (it is asked about any email).
 */
export function avatarSources(email: string, accounts: Account[]): string[] {
  const address = email.trim().toLowerCase()
  const sources: string[] = []
  const noreply = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/.exec(address)
  if (noreply) {
    sources.push(
      noreply[1]
        ? `https://avatars.githubusercontent.com/u/${noreply[1]}?s=${SIZE}`
        : `https://github.com/${noreply[2]}.png?size=${SIZE}`
    )
  }
  for (const a of accounts) {
    if (a.provider === 'github' && a.host === 'github.com' && a.email.trim().toLowerCase() === address) {
      sources.push(`https://github.com/${a.username}.png?size=${SIZE}`)
    }
  }
  sources.push(`https://gravatar.com/avatar/${createHash('sha256').update(address).digest('hex')}?s=${SIZE}&d=404`)
  return [...new Set(sources)]
}

export interface AvatarContext {
  accounts: Account[]
  /** The picture the repository's server has for the author of a commit (GitHub's API), when it can say. */
  commitAvatar?: (hash: string) => Promise<string | null>
}

interface Entry {
  /** A data: URL, or null when no source has a picture. */
  data: string | null
  at: number
}

/** Authors' pictures as data: URLs (the window shows no remote images), kept on disk for a while. */
export class AvatarCache {
  private entries: Record<string, Entry> | null = null

  constructor(
    private readonly file: string,
    private readonly fetchFn: ImageFetch = (url) => fetch(url)
  ) {}

  /** The picture of each person (lowercased email -> data: URL, or null), fetched only when not known yet. */
  async get(people: { email: string; hash?: string }[], ctx: AvatarContext): Promise<Record<string, string | null>> {
    const entries = this.load()
    const now = Date.now()
    const result: Record<string, string | null> = {}
    const missing = new Map<string, string | undefined>()
    for (const { email, hash } of people) {
      const key = email.trim().toLowerCase()
      if (!key || key in result || missing.has(key)) continue
      const known = entries[key]
      if (known && now - known.at < (known.data ? FOUND_FOR : NONE_FOR)) result[key] = known.data
      else missing.set(key, hash)
    }
    const queue = [...missing]
    let changed = false
    const work = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [key, hash] = next
        const { data, reached } = await this.pictureFor(key, hash, ctx)
        result[key] = data
        // A server that could not be reached is asked again next time.
        if (reached) {
          entries[key] = { data, at: now }
          changed = true
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, work))
    if (changed) this.save(entries)
    return result
  }

  private async pictureFor(email: string, hash: string | undefined, ctx: AvatarContext) {
    const sources = avatarSources(email, ctx.accounts)
    const gravatar = sources.pop()!
    let reached = true
    const tryUrl = async (url: string) => {
      try {
        return await this.image(url)
      } catch {
        reached = false
        return null
      }
    }
    for (const url of sources) {
      const data = await tryUrl(url)
      if (data) return { data, reached }
    }
    if (hash && ctx.commitAvatar) {
      const url = await ctx.commitAvatar(hash).catch(() => null)
      const data = url && (await tryUrl(sized(url)))
      if (data) return { data, reached }
    }
    return { data: await tryUrl(gravatar), reached }
  }

  /** The picture at `url` as a data: URL; null when there is none (404, not an image, too big). */
  private async image(url: string): Promise<string | null> {
    const res = await this.fetchFn(url)
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_BYTES) return null
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`
  }

  private load(): Record<string, Entry> {
    if (this.entries) return this.entries
    try {
      this.entries = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Entry>
    } catch {
      this.entries = {}
    }
    return this.entries
  }

  private save(entries: Record<string, Entry>): void {
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(entries))
      renameSync(`${this.file}.tmp`, this.file)
    } catch {
      // Not critical: the pictures are fetched again next time.
    }
  }
}
