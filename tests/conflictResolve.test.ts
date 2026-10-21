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

/** main and `other` both edit a.txt, then main merges other. */
async function conflictOnA() {
  await commitFile('a.txt', 'base\n', 'base')
  await repo.createBranch(dir, 'other', null, true)
  await commitFile('a.txt', 'theirs\n', 'other edits')
  await repo.checkout(dir, 'main')
  await commitFile('a.txt', 'ours\n', 'main edits')
  await repo.merge(dir, 'other').catch(() => {})
}

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-conflict-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

describe('conflict resolution', () => {
  it('reads the conflicted file with its markers', async () => {
    await conflictOnA()
    const file = await repo.readWorkingFile(dir, 'a.txt')
    expect(file.binary).toBe(false)
    expect(file.text).toContain('<<<<<<<')
  })

  it('writes a resolution and marks the file resolved', async () => {
    await conflictOnA()
    await repo.resolveConflictFile(dir, 'a.txt', 'merged\n')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('merged\n')
    const { status } = await repo.getState(dir)
    expect(status.conflicted).toEqual([])
    expect(status.staged.map((f) => f.path)).toContain('a.txt')
  })

  it('takes one side of the whole file', async () => {
    await conflictOnA()
    await repo.resolveConflictWith(dir, 'a.txt', 'ours')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('ours\n')
    expect((await repo.getState(dir)).status.conflicted).toEqual([])
  })

  it('takes the deletion when the incoming side deleted the file', async () => {
    await commitFile('a.txt', 'base\n', 'base')
    await repo.createBranch(dir, 'other', null, true)
    await git(['rm', '-q', 'a.txt'], { cwd: dir })
    await repo.commit(dir, 'delete a', false)
    await repo.checkout(dir, 'main')
    await commitFile('a.txt', 'changed here\n', 'edit a')
    await repo.merge(dir, 'other').catch(() => {})
    expect((await repo.getState(dir)).status.conflicted.map((f) => f.path)).toEqual(['a.txt'])

    await repo.resolveConflictWith(dir, 'a.txt', 'theirs')
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
    const { status } = await repo.getState(dir)
    expect(status.conflicted).toEqual([])
    expect(status.staged).toEqual([{ path: 'a.txt', status: 'D' }])
  })
})
