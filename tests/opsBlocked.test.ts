import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { parseChangesBlock } from '../src/shared/localChanges'

let root: string
let dir: string
let side: string

const run = (args: string[], cwd = dir) => git(args, { cwd })
const head = async () => (await run(['rev-parse', 'HEAD'])).stdout.trim()

async function commitFile(name: string, content: string, message: string): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return head()
}

// main has a.txt and b.txt; side changes a.txt; the remote's main is side's commit, for pull.
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-test-'))
  await git(['init', '-q', '--bare', '-b', 'main', join(root, 'origin.git')], { cwd: root })
  dir = await repo.initRepo(join(root, 'repo'), 'main')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ]) {
    await run(['config', key, value])
  }
  await commitFile('a.txt', 'base\n', 'base')
  await run(['remote', 'add', 'origin', join(root, 'origin.git')])
  await run(['push', '-q', '-u', 'origin', 'main'])
  await repo.createBranch(dir, 'side', null, true)
  side = await commitFile('a.txt', 'side\n', 'side')
  await run(['push', '-q', 'origin', `${side}:refs/heads/main`])
  await repo.checkout(dir, 'main')
  await run(['fetch', '-q'])
  writeFileSync(join(dir, 'a.txt'), 'local\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('parseChangesBlock', () => {
  it('reads the files a merge (or a cherry-pick, revert or pull) would overwrite', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '\ta.txt',
      'Please commit your changes or stash them before you merge.',
      'error: The following untracked working tree files would be overwritten by merge:',
      '\tc.txt',
      'Please move or remove them before you merge.',
      'Aborting',
      'fatal: cherry-pick failed'
    ].join('\n')
    expect(parseChangesBlock(stderr)).toEqual({ changed: ['a.txt'], untracked: ['c.txt'], folders: [], all: false })
  })

  it('reads a rebase refused for any uncommitted change, which names no file', () => {
    for (const stderr of [
      'error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.',
      'error: cannot pull with rebase: Your index contains uncommitted changes.\nerror: Please commit or stash them.'
    ]) {
      expect(parseChangesBlock(stderr)).toEqual({ changed: [], untracked: [], folders: [], all: true })
    }
  })
})

describe('operations stopped by uncommitted changes', () => {
  it('a merge says which files are in the way, and changes nothing', async () => {
    const before = await head()
    expect(await repo.merge(dir, 'side')).toMatchObject({ changed: ['a.txt'], all: false })
    expect(await head()).toBe(before)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('local\n')
    expect((await repo.getState(dir)).operation).toBeNull()
  })

  it('a cherry-pick and a revert too', async () => {
    expect(await repo.cherryPick(dir, side)).toMatchObject({ changed: ['a.txt'] })
    // On side, reverting its own commit over a.txt changed here.
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    await repo.checkout(dir, 'side')
    writeFileSync(join(dir, 'a.txt'), 'local\n')
    expect(await repo.revert(dir, side)).toMatchObject({ changed: ['a.txt'] })
    expect((await repo.getState(dir)).operation).toBeNull()
  })

  it('a pull that merges too, and one that rebases is stopped by any change', async () => {
    expect(await repo.pull(dir, 'ff', () => {})).toMatchObject({ changed: ['a.txt'] })
    expect(await repo.pull(dir, 'rebase', () => {})).toMatchObject({ all: true })
  })

  it('a rebase is stopped by any uncommitted change', async () => {
    expect(await repo.rebase(dir, 'side')).toMatchObject({ changed: [], all: true })
  })

  it('is nothing when the operation goes through', async () => {
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    writeFileSync(join(dir, 'b.txt'), 'unrelated\n')
    expect(await repo.merge(dir, 'side')).toBeNull()
    expect(await head()).toBe(side)
  })

  it('still fails when a rebase stops part-way for an untracked file, as it did start', async () => {
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    await repo.checkout(dir, 'side')
    await commitFile('two.txt', 'two\n', 'add two')
    await run(['rm', '-q', '--cached', 'two.txt'])
    await repo.commit(dir, 'untrack two', false)
    await repo.checkout(dir, 'main')
    await commitFile('main.txt', 'main\n', 'main work')
    await repo.checkout(dir, 'side')

    await expect(repo.rebase(dir, 'main')).rejects.toThrow(/untracked working tree files would be overwritten/)
    expect((await repo.getState(dir)).operation).toBe('rebase')
  })

  it('still fails when the operation stops for conflicts', async () => {
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    await commitFile('a.txt', 'main\n', 'main edit')
    await expect(repo.merge(dir, 'side')).rejects.toThrow()
    expect((await repo.getState(dir)).operation).toBe('merge')
  })
})
