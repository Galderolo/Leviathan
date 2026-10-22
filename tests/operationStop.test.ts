import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { stoppedOperation } from '../src/renderer/src/operationStop'

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
  await commitFile('readme.txt', 'base\n', 'base')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

describe('stoppedOperation', () => {
  it('sees a cherry-pick that stopped for a file both sides added', async () => {
    await repo.createBranch(dir, 'other', null, true)
    const picked = await commitFile('book.pdf', 'theirs\n', 'add the book there')
    await repo.checkout(dir, 'main')
    await commitFile('book.pdf', 'ours\n', 'add the book here')

    await expect(repo.cherryPick(dir, picked)).rejects.toThrow()
    expect(stoppedOperation(null, await repo.getState(dir))).toEqual({ operation: 'cherry-pick', conflicts: 1 })
  })

  it('is nothing when the command failed without starting an operation', async () => {
    await expect(repo.cherryPick(dir, 'no-such-commit')).rejects.toThrow()
    expect(stoppedOperation(null, await repo.getState(dir))).toBeNull()
  })

  it('is nothing when the operation was already under way (git refused the command)', async () => {
    const state = await repo.getState(dir)
    expect(stoppedOperation('merge', { ...state, operation: 'merge' })).toBeNull()
    expect(stoppedOperation(null, null)).toBeNull()
  })
})
