import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { diffSnapshots, invertChange } from '../src/shared/undo'

let dir: string

async function commitFile(name: string, content: string, message: string): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
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
  await commitFile('a.txt', 'base\n', 'base')
  await repo.createBranch(dir, 'feature', null, true)
  await commitFile('a.txt', 'feature\n', 'change a')
  await commitFile('b.txt', 'new\n', 'add b')
  await repo.checkout(dir, 'main')
  await commitFile('c.txt', 'main\n', 'main work')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('squash merge', () => {
  it("tells the branch's commits not on this one and the files they change", async () => {
    expect(await repo.squashInfo(dir, 'feature')).toEqual({
      subjects: ['change a', 'add b'],
      paths: ['a.txt', 'b.txt']
    })
  })

  it("stages the branch's changes as one, without committing nor leaving a merge under way", async () => {
    const head = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    expect(await repo.mergeSquash(dir, 'feature')).toBeNull()

    expect((await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()).toBe(head)
    const state = await repo.getState(dir)
    expect(state.operation).toBeNull()
    expect(state.status.staged.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('is undone with the files it changed', async () => {
    const before = await repo.getSnapshot(dir, ['a.txt', 'b.txt'])
    await repo.mergeSquash(dir, 'feature')
    const change = diffSnapshots(before, await repo.getSnapshot(dir, ['a.txt', 'b.txt']), 'keep')!
    await repo.applyChange(dir, invertChange(change))

    expect((await repo.getState(dir)).status.staged).toEqual([])
    expect(existsSync(join(dir, 'b.txt'))).toBe(false)
  })

  it('is stopped by uncommitted changes in its way, as a merge is', async () => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    expect(await repo.mergeSquash(dir, 'feature')).toMatchObject({ changed: ['a.txt'] })
  })
})
