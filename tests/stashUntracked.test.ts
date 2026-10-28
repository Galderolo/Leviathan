import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string

async function commitFile(name: string, content: string, message: string) {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
}

async function topStash() {
  return (await repo.getState(dir)).stashes[0]
}

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-test-')), 'repo'), 'main')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
  await commitFile('tracked.txt', 'base\n', 'base')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('untracked files of a stash', () => {
  it('lists them among the files of the stash', async () => {
    writeFileSync(join(dir, 'tracked.txt'), 'changed\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await repo.stashSave(dir, null)

    const details = await repo.getCommitDetails(dir, (await topStash()).hash)
    expect(details.files).toEqual([
      { path: 'tracked.txt', status: 'M' },
      { path: 'new.txt', status: '?' }
    ])
  })

  it('shows the content of one of them', async () => {
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await repo.stashSave(dir, null)
    const stash = await topStash()

    const diff = await repo.getDiff(dir, {
      kind: 'commit',
      hash: stash.hash,
      parent: stash.baseHash,
      path: 'new.txt',
      untracked: true
    })
    expect(
      diff.hunks
        .flatMap((h) => h.lines)
        .filter((l) => l.type === 'add')
        .map((l) => l.text)
    ).toEqual(['new'])
  })

  it('adds nothing for a merge of three branches, which is not a stash', async () => {
    await repo.createBranch(dir, 'one', null, true)
    await commitFile('one.txt', 'one\n', 'one')
    await repo.checkout(dir, 'main')
    await repo.createBranch(dir, 'two', null, true)
    await commitFile('two.txt', 'two\n', 'two')
    await repo.checkout(dir, 'main')
    await git(['merge', '-q', '--no-ff', '--no-edit', 'one', 'two'], { cwd: dir })
    const head = (await repo.getState(dir)).head.hash!

    const details = await repo.getCommitDetails(dir, head)
    expect(details.commit.parents).toHaveLength(3)
    expect(details.files.some((f) => f.status === '?')).toBe(false)
  })
})

describe('stashUntrackedClashes', () => {
  it('names the untracked files of a stash that already exist, which applying it leaves out', async () => {
    writeFileSync(join(dir, 'tracked.txt'), 'changed\n')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    writeFileSync(join(dir, 'b.txt'), 'b\n')
    await repo.stashSave(dir, null)
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    const stash = await topStash()

    expect(await repo.stashUntrackedClashes(dir, stash.index, stash.hash)).toEqual(['a.txt'])

    // What git does then, which the app's message describes: the rest is applied, the stash kept.
    await expect(repo.stashPop(dir, stash.index, stash.hash)).rejects.toThrow()
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('mine\n')
    expect(existsSync(join(dir, 'b.txt'))).toBe(true)
    expect(readFileSync(join(dir, 'tracked.txt'), 'utf8')).toBe('changed\n')
    expect((await repo.getState(dir)).stashes).toHaveLength(1)
  })

  it('is empty for a stash without untracked files', async () => {
    writeFileSync(join(dir, 'tracked.txt'), 'changed\n')
    await repo.stashSave(dir, null)
    const stash = await topStash()
    expect(await repo.stashUntrackedClashes(dir, stash.index, stash.hash)).toEqual([])
  })
})

describe('stashTrackedClashes', () => {
  it('names the files the stash changes that have uncommitted changes, which make git refuse to apply it', async () => {
    await commitFile('other.txt', 'base\n', 'other')
    writeFileSync(join(dir, 'tracked.txt'), 'stashed\n')
    await repo.stashSave(dir, null)
    const stash = await topStash()
    expect(await repo.stashTrackedClashes(dir, stash.index, stash.hash)).toEqual([])

    // A change elsewhere is no clash; one in the same file is, staged or not.
    writeFileSync(join(dir, 'other.txt'), 'mine\n')
    expect(await repo.stashTrackedClashes(dir, stash.index, stash.hash)).toEqual([])
    writeFileSync(join(dir, 'tracked.txt'), 'mine\n')
    expect(await repo.stashTrackedClashes(dir, stash.index, stash.hash)).toEqual(['tracked.txt'])
    await expect(repo.stashApply(dir, stash.index, stash.hash)).rejects.toThrow(/overwritten/)
    await repo.stage(dir, ['tracked.txt'])
    expect(await repo.stashTrackedClashes(dir, stash.index, stash.hash)).toEqual(['tracked.txt'])
  })
})
