import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string

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
  for (const name of ['a.txt', 'b.txt', '[id].txt', 'i.txt']) writeFileSync(join(dir, name), 'base\n')
  await repo.stageAll(dir)
  await repo.commit(dir, 'base', false)
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

describe('stashing some files', () => {
  it('stashes only the files given, new ones included, and leaves the rest as it was', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed a\n')
    writeFileSync(join(dir, 'b.txt'), 'changed b\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await repo.stage(dir, ['b.txt'])

    await repo.stashSave(dir, null, ['a.txt', 'new.txt'])

    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('base\n')
    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    const { status, stashes } = await repo.getState(dir)
    expect(status.staged.map((f) => f.path)).toEqual(['b.txt'])
    expect(stashes).toHaveLength(1)
    // git keeps a picture of the whole index in the stash, so the staged b.txt shows there too (unchanged here).
    const files = (await repo.getCommitDetails(dir, stashes[0].hash)).files.map((f) => f.path)
    expect(files).toEqual(expect.arrayContaining(['a.txt', 'new.txt']))
  })

  it('takes file names literally', async () => {
    writeFileSync(join(dir, '[id].txt'), 'changed\n')
    writeFileSync(join(dir, 'i.txt'), 'changed\n')
    await repo.stashSave(dir, null, ['[id].txt'])
    expect(readFileSync(join(dir, '[id].txt'), 'utf8')).toBe('base\n')
    expect(readFileSync(join(dir, 'i.txt'), 'utf8')).toBe('changed\n')
  })

  it('refuses a path outside the repository', async () => {
    await expect(repo.stashSave(dir, null, ['../elsewhere.txt'])).rejects.toThrow()
  })
})
