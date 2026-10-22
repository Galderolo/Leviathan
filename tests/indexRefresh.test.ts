import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { refreshIndexStat, shouldRefreshIndex } from '../src/main/git/repository'
import { git, holdingIndex } from '../src/main/git/runner'

let root: string
let work: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-index-'))
  work = await repo.initRepo(join(root, 'work'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false']
  ])
    await git(['config', k, v], { cwd: work })
  writeFileSync(join(work, 'a.txt'), 'a\n')
  await repo.stage(work, ['a.txt'])
  await repo.commit(work, 'base', false)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('shouldRefreshIndex', () => {
  it('refreshes after a slow status, at most every five minutes', () => {
    expect(shouldRefreshIndex(1_000_000, undefined, 499)).toBe(false)
    expect(shouldRefreshIndex(1_000_000, undefined, 500)).toBe(true)
    expect(shouldRefreshIndex(1_000_000, 1_000_000 - 60_000, 2000)).toBe(false)
    expect(shouldRefreshIndex(1_000_000, 1_000_000 - 300_000, 2000)).toBe(true)
  })
})

describe('refreshIndexStat', () => {
  it('updates the stat info of files touched without changes, and keeps what is staged', async () => {
    const later = new Date(Date.now() + 120_000)
    utimesSync(join(work, 'a.txt'), later, later)
    writeFileSync(join(work, 'b.txt'), 'staged\n')
    await repo.stage(work, ['b.txt'])
    const staged = (await git(['rev-parse', ':b.txt'], { cwd: work })).stdout.trim()
    // diff-files trusts the index's stat info: the touched file looks changed until the index is refreshed.
    expect((await git(['diff-files', '--quiet'], { cwd: work, okCodes: [0, 1] })).exitCode).toBe(1)

    await refreshIndexStat(work)
    expect((await git(['diff-files', '--quiet'], { cwd: work, okCodes: [0, 1] })).exitCode).toBe(0)
    expect((await git(['rev-parse', ':b.txt'], { cwd: work })).stdout.trim()).toBe(staged)
  })

  it('gives up quietly when another git holds the index', async () => {
    writeFileSync(join(work, '.git', 'index.lock'), '')
    await expect(refreshIndexStat(work)).resolves.toBeUndefined()
  })
})

describe('index lock held by someone else', () => {
  it('stages once the lock is released instead of failing', async () => {
    writeFileSync(join(work, 'c.txt'), 'c\n')
    const lock = join(work, '.git', 'index.lock')
    writeFileSync(lock, '')
    setTimeout(() => unlinkSync(lock), 600)
    await repo.stage(work, ['c.txt'])
    expect((await repo.getState(work)).status.staged.map((f) => f.path)).toEqual(['c.txt'])
  })

  it("waits for the app's own index refresh instead of failing on its lock", async () => {
    writeFileSync(join(work, 'a.txt'), 'changed\n')
    const lock = join(work, '.git', 'index.lock')
    // Held longer than the retries of locking commands last; stash is not even retried.
    const held = holdingIndex(work, async () => {
      writeFileSync(lock, '')
      await new Promise((r) => setTimeout(r, 2500))
      unlinkSync(lock)
    })
    await repo.stashSave(work, 'while refreshing')
    await held
    expect((await repo.getState(work)).stashes).toHaveLength(1)
  })

  it('still fails, with git’s message, when the lock never goes away', async () => {
    writeFileSync(join(work, 'c.txt'), 'c\n')
    writeFileSync(join(work, '.git', 'index.lock'), '')
    await expect(repo.stage(work, ['c.txt'])).rejects.toThrow(/index\.lock/)
  })
})
