import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { stopReason, stoppedOperation } from '../src/renderer/src/operationStop'

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

describe('stopReason', () => {
  it("keeps git's reason for stopping a rebase, without its hints about commands", async () => {
    const base = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    const one = await commitFile('one.txt', 'one\n', 'add one')
    const two = await commitFile('two.txt', 'two\n', 'add two')
    // two.txt leaves the index, so it can stand in the way untracked when "add two" is picked again.
    await git(['rm', '-q', '--cached', 'two.txt'], { cwd: dir })
    await repo.commit(dir, 'untrack two', false)
    const untrack = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    writeFileSync(join(dir, 'two.txt'), 'mine\n')

    const items = [one, two, untrack].map((hash) => ({ hash, action: 'pick' as const, message: '' }))
    const error = await repo.interactiveRebase(dir, base, [{ ...items[0], action: 'drop' }, ...items.slice(1)]).then(
      () => null,
      (err: Error) => err
    )
    const state = await repo.getState(dir)
    expect(stoppedOperation(null, state)).toEqual({ operation: 'rebase', conflicts: 0 })
    expect(stopReason(error!.message)).toBe(
      'The following untracked working tree files would be overwritten by merge:\ntwo.txt\n' +
        'Please move or remove them before you merge.'
    )
  })

  it('drops progress, hints and the lines that name commands', () => {
    const message = [
      'Rebasing (2/3)',
      'error: could not apply 4ca217d... add two',
      'hint: Resolve all conflicts manually, mark them as resolved with',
      'hint: "git add/rm <conflicted_files>", then run "git rebase --continue".',
      'Could not apply 4ca217d... add two',
      'fatal: something else'
    ].join('\n')
    expect(stopReason(message)).toBe('could not apply 4ca217d... add two\nsomething else')
  })
})
