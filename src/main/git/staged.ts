import { git, type RunOptions } from './runner'

/** LFS pointers are under 1 KB: a bigger staged blob of a file that goes through LFS is the file's whole content. */
export const POINTER_MAX_BYTES = 1024

/** Blob sizes never change: they are remembered by hash, at most `limit` of them (the oldest are forgotten first). */
export class SizeCache {
  private readonly sizes = new Map<string, number>()

  constructor(private readonly limit: number) {}

  get(hash: string): number | undefined {
    return this.sizes.get(hash)
  }

  /** The hashes whose size is not known yet, without repeats. */
  missing(hashes: string[]): string[] {
    return [...new Set(hashes)].filter((h) => !this.sizes.has(h))
  }

  set(hash: string, size: number): void {
    this.sizes.delete(hash)
    this.sizes.set(hash, size)
    while (this.sizes.size > this.limit) this.sizes.delete(this.sizes.keys().next().value as string)
  }
}

// Asked on every refresh: an initial import with thousands of staged files would otherwise take seconds each time.
const sizes = new SizeCache(100_000)

async function run(cwd: string, args: string[], extra: Partial<RunOptions> = {}): Promise<string> {
  return (await git(args, { cwd, ...extra })).stdout
}

export interface StagedBlob {
  path: string
  /** Hash of the staged content. */
  hash: string
  size: number
}

/** Staged files that were added or modified (regular files only), with their staged content. */
export async function stagedBlobs(repo: string): Promise<StagedBlob[]> {
  const raw = (await run(repo, ['diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-renames', '--diff-filter=AM']))
    .split('\0')
    .filter(Boolean)
  const blobs: { path: string; hash: string }[] = []
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [, mode, , hash] = raw[i].slice(1).split(' ')
    if (mode === '100644' || mode === '100755') blobs.push({ path: raw[i + 1], hash })
  }
  const missing = sizes.missing(blobs.map((b) => b.hash))
  if (missing.length) {
    const out = await run(repo, ['cat-file', '--batch-check=%(objectname) %(objectsize)'], {
      input: missing.join('\n') + '\n'
    })
    for (const line of out.split('\n')) {
      const [hash, size] = line.split(' ')
      if (hash && /^\d+$/.test(size ?? '')) sizes.set(hash, Number(size))
    }
  }
  return blobs.map((b) => ({ ...b, size: sizes.get(b.hash) ?? 0 }))
}

/** The files among `paths` whose attributes send them through LFS. */
export async function lfsFilesAmong(repo: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return []
  const parts = (await run(repo, ['check-attr', '-z', '--stdin', 'filter'], { input: paths.join('\0') })).split('\0')
  const out: string[] = []
  for (let i = 0; i + 2 < parts.length; i += 3) if (parts[i + 2] === 'lfs') out.push(parts[i])
  return out
}

/** Staged files that should go through LFS but are staged with their whole content (no git-lfs, or staged before the pattern existed). */
export function plainLfs(blobs: StagedBlob[], lfsFiles: string[]): StagedBlob[] {
  const lfs = new Set(lfsFiles)
  return blobs.filter((b) => lfs.has(b.path) && b.size > POINTER_MAX_BYTES)
}
