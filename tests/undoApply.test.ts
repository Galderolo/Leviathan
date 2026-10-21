import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { diffSnapshots, invertChange, type RepoChange } from '../src/shared/undo'

let dir: string

async function commitFile(name: string, content: string, message: string) {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
}

/** Runs an operation and returns what it changed, like the UI records it. */
async function track(op: () => Promise<unknown>, mode: RepoChange['mode'] = 'keep'): Promise<RepoChange> {
  const before = await repo.getSnapshot(dir)
  await op()
  const after = await repo.getSnapshot(dir)
  const change = diffSnapshots(before, after, mode)
  if (!change) throw new Error('nothing changed')
  return change
}

const subject = async () => (await git(['log', '-1', '--format=%s'], { cwd: dir })).stdout.trim()

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-undo-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
  await commitFile('a.txt', 'a\n', 'base')
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

describe('applyChange', () => {
  it('undoes a commit keeping its changes staged, and redoes it', async () => {
    writeFileSync(join(dir, 'b.txt'), 'b\n')
    await repo.stage(dir, ['b.txt'])
    const change = await track(() => repo.commit(dir, 'second', false), 'soft')

    await repo.applyChange(dir, invertChange(change))
    expect(await subject()).toBe('base')
    expect((await repo.getState(dir)).status.staged).toEqual([{ path: 'b.txt', status: 'A' }])

    await repo.applyChange(dir, change)
    expect(await subject()).toBe('second')
    expect((await repo.getState(dir)).status.staged).toEqual([])
  })

  it('undoes an amend back to the original commit', async () => {
    const original = (await repo.getSnapshot(dir)).head.hash
    const change = await track(() => repo.commit(dir, 'base (amended)', true), 'soft')
    await repo.applyChange(dir, invertChange(change))
    expect((await repo.getSnapshot(dir)).head.hash).toBe(original)
  })

  it('undoes creating and checking out a branch', async () => {
    const change = await track(() => repo.createBranch(dir, 'topic', null, true))
    await repo.applyChange(dir, invertChange(change))
    const snap = await repo.getSnapshot(dir)
    expect(snap.head.branch).toBe('main')
    expect(snap.refs['refs/heads/topic']).toBeUndefined()
  })

  it('brings a deleted branch back', async () => {
    await repo.createBranch(dir, 'old', null, false)
    const hash = (await repo.getSnapshot(dir)).refs['refs/heads/old']
    const change = await track(() => repo.deleteBranch(dir, 'old', false))
    await repo.applyChange(dir, invertChange(change))
    expect((await repo.getSnapshot(dir)).refs['refs/heads/old']).toBe(hash)
  })

  it('undoes a merge', async () => {
    await repo.createBranch(dir, 'side', null, true)
    await commitFile('s.txt', 's\n', 'side work')
    await repo.checkout(dir, 'main')
    await commitFile('m.txt', 'm\n', 'main work')
    const beforeMerge = (await repo.getSnapshot(dir)).head.hash
    const change = await track(() => repo.merge(dir, 'side'))
    await repo.applyChange(dir, invertChange(change))
    expect((await repo.getSnapshot(dir)).head.hash).toBe(beforeMerge)
  })

  it('restores a deleted annotated tag with its message', async () => {
    const head = (await repo.getSnapshot(dir)).head.hash!
    await repo.createTag(dir, 'v1', head, 'Release one')
    const change = await track(() => repo.deleteTag(dir, 'v1'))
    await repo.applyChange(dir, invertChange(change))
    expect((await git(['cat-file', '-t', 'v1'], { cwd: dir })).stdout.trim()).toBe('tag')
    expect((await git(['tag', '-l', '--format=%(contents:subject)', 'v1'], { cwd: dir })).stdout.trim()).toBe(
      'Release one'
    )
  })

  it('refuses when the repository changed since the action', async () => {
    await repo.createBranch(dir, 'topic', null, false)
    const change = await track(() => repo.checkout(dir, 'topic'))
    await commitFile('c.txt', 'c\n', 'made elsewhere')
    await expect(repo.applyChange(dir, invertChange(change))).rejects.toThrow(/can no longer be undone/)
  })

  it('never overwrites local changes that conflict', async () => {
    await repo.createBranch(dir, 'side', null, true)
    await commitFile('a.txt', 'side version\n', 'side edits a')
    await repo.checkout(dir, 'main')
    const change = await track(() => repo.merge(dir, 'side'))
    writeFileSync(join(dir, 'a.txt'), 'my unsaved work\n')
    await expect(repo.applyChange(dir, invertChange(change))).rejects.toThrow()
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('my unsaved work\n')
  })
})
