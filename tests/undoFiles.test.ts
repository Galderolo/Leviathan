import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { diffSnapshots, invertChange, type RepoChange } from '../src/shared/undo'

let dir: string

/** Runs an operation that changes `paths` and returns what it changed, like the UI records it. */
async function track(op: () => Promise<unknown>, paths: string[] = []): Promise<RepoChange> {
  const before = await repo.getSnapshot(dir, paths)
  await op()
  const after = await repo.getSnapshot(dir, paths)
  const change = diffSnapshots(before, after, 'keep')
  if (!change) throw new Error('nothing changed')
  return change
}

const read = (name: string) => readFileSync(join(dir, name), 'utf8')
const status = async () => (await git(['status', '--porcelain'], { cwd: dir })).stdout
const stashes = async () =>
  (await git(['stash', 'list', '--format=%H'], { cwd: dir })).stdout.split('\n').filter(Boolean)

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-undo-files-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  await repo.stage(dir, ['a.txt'])
  await repo.commit(dir, 'base', false)
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('undoing a discard', () => {
  it('brings the discarded changes back, and discards them again on redo', async () => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    const change = await track(() => repo.discard(dir, ['a.txt'], []), ['a.txt'])
    expect(read('a.txt')).toBe('a\n')
    await repo.applyChange(dir, invertChange(change))
    expect(read('a.txt')).toBe('mine\n')
    await repo.applyChange(dir, change)
    expect(read('a.txt')).toBe('a\n')
  })

  it('brings back a new file that was deleted, as it was, byte for byte', async () => {
    const bytes = Buffer.from([0, 1, 2, 13, 10, 255, 10])
    writeFileSync(join(dir, 'new.bin'), bytes)
    const change = await track(() => repo.discard(dir, [], ['new.bin']), ['new.bin'])
    expect(existsSync(join(dir, 'new.bin'))).toBe(false)
    await repo.applyChange(dir, invertChange(change))
    expect(readFileSync(join(dir, 'new.bin')).equals(bytes)).toBe(true)
    expect(await status()).toBe('?? new.bin\n')
  })

  it('leaves what is staged as it was', async () => {
    writeFileSync(join(dir, 'a.txt'), 'staged\n')
    await repo.stage(dir, ['a.txt'])
    writeFileSync(join(dir, 'a.txt'), 'staged and more\n')
    const change = await track(() => repo.discard(dir, ['a.txt'], []), ['a.txt'])
    expect(read('a.txt')).toBe('staged\n')
    await repo.applyChange(dir, invertChange(change))
    expect(read('a.txt')).toBe('staged and more\n')
    expect((await git(['show', ':a.txt'], { cwd: dir })).stdout).toBe('staged\n')
  })

  it('refuses when the file changed since, leaving it as it is', async () => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    const change = await track(() => repo.discard(dir, ['a.txt'], []), ['a.txt'])
    writeFileSync(join(dir, 'a.txt'), 'typed since\n')
    await expect(repo.applyChange(dir, invertChange(change))).rejects.toThrow('can no longer be undone')
    expect(read('a.txt')).toBe('typed since\n')
  })

  it('copies no file over the size limit: such a discard cannot be undone', async () => {
    writeFileSync(join(dir, 'big.psd'), 'x'.repeat(64))
    const snapshot = await repo.getSnapshot(dir, ['big.psd', 'a.txt'], 32)
    expect(snapshot.tooLarge).toEqual(['big.psd'])
  })
})

describe('undoing a hard reset', () => {
  it('brings back the branch and the uncommitted changes it dropped, and drops them again on redo', async () => {
    const base = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    writeFileSync(join(dir, 'a.txt'), 'second\n')
    await repo.stage(dir, ['a.txt'])
    await repo.commit(dir, 'second', false)
    const second = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    writeFileSync(join(dir, 'a.txt'), 'staged\n')
    await repo.stage(dir, ['a.txt'])
    writeFileSync(join(dir, 'a.txt'), 'staged and more\n')

    const change = await track(() => repo.reset(dir, base, 'hard'), ['a.txt'])
    expect(read('a.txt')).toBe('a\n')
    await repo.applyChange(dir, invertChange(change))
    expect((await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()).toBe(second)
    expect(read('a.txt')).toBe('staged and more\n')
    expect((await git(['show', ':a.txt'], { cwd: dir })).stdout).toBe('staged\n')

    await repo.applyChange(dir, change)
    expect((await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()).toBe(base)
    expect(read('a.txt')).toBe('a\n')
    expect(await status()).toBe('')
  })
})

describe('undoing stashes', () => {
  it('undoes saving a stash: the changes come back and the stash goes, and redo saves it again', async () => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    const change = await track(() => repo.stashSave(dir, 'work'), ['a.txt', 'new.txt'])
    const [saved] = await stashes()
    expect(await status()).toBe('')
    await repo.applyChange(dir, invertChange(change))
    expect(read('a.txt')).toBe('mine\n')
    expect(read('new.txt')).toBe('new\n')
    expect(await stashes()).toEqual([])
    await repo.applyChange(dir, change)
    expect(await status()).toBe('')
    expect(await stashes()).toEqual([saved])
  })

  it('undoes popping a stash: the stash is back and the changes leave again', async () => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    await repo.stashSave(dir, 'work')
    const [saved] = await stashes()
    const change = await track(() => repo.stashPop(dir, 0, saved), ['a.txt'])
    expect(read('a.txt')).toBe('mine\n')
    await repo.applyChange(dir, invertChange(change))
    expect(read('a.txt')).toBe('a\n')
    expect(await stashes()).toEqual([saved])
    expect((await git(['stash', 'list', '--format=%gs'], { cwd: dir })).stdout.trim()).toBe('On main: work')
  })

  it('lists the files a stash changes, its new ones too', async () => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await repo.stashSave(dir, 'work')
    const [saved] = await stashes()
    expect((await repo.stashPaths(dir, 0, saved)).sort()).toEqual(['a.txt', 'new.txt'])
  })

  it('brings a dropped stash back', async () => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    await repo.stashSave(dir, 'work')
    const [saved] = await stashes()
    const change = await track(() => repo.stashDrop(dir, 0, saved))
    expect(await stashes()).toEqual([])
    await repo.applyChange(dir, invertChange(change))
    expect(await stashes()).toEqual([saved])
  })
})
