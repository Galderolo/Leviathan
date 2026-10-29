import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { parseCheckoutBlock } from '../src/shared/checkout'

let dir: string

async function commitFile(name: string, content: string, message: string): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

const head = async () => (await repo.getState(dir)).head.branch

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
  await commitFile('shared data.asset', 'base\n', 'base')
  await repo.createBranch(dir, 'other', null, true)
  await commitFile('shared data.asset', 'other\n', 'on other')
  await commitFile('new.txt', 'tracked on other\n', 'new on other')
  await repo.checkout(dir, 'main')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('parseCheckoutBlock', () => {
  it("reads the files of git's refusal, each kind on its own", () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\tstaged.txt',
      'Please commit your changes or stash them before you switch branches.',
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\t a b.txt ',
      '\tAssets/Tables/Rising Shared Data.asset',
      'Please commit your changes or stash them before you switch branches.',
      'error: Updating the following directories would lose untracked files in them:',
      '\td',
      '',
      'error: The following untracked working tree files would be overwritten by checkout:',
      '\tnew.txt',
      'Please move or remove them before you switch branches.',
      'error: The following untracked working tree files would be removed by checkout:',
      '\tgone.txt',
      'Please move or remove them before you switch branches.',
      'Aborting'
    ].join('\n')
    expect(parseCheckoutBlock(stderr)).toEqual({
      changed: ['staged.txt', ' a b.txt ', 'Assets/Tables/Rising Shared Data.asset'],
      untracked: ['new.txt', 'gone.txt'],
      folders: ['d']
    })
  })

  it('reads lines ending in CRLF', () => {
    const stderr =
      'error: Your local changes to the following files would be overwritten by checkout:\r\n\ta.txt\r\nAborting\r\n'
    expect(parseCheckoutBlock(stderr)).toEqual({ changed: ['a.txt'], untracked: [], folders: [] })
  })

  it('is nothing for any other failure', () => {
    expect(parseCheckoutBlock("error: pathspec 'nope' did not match any file(s) known to git")).toBeNull()
    expect(parseCheckoutBlock('')).toBeNull()
  })
})

describe('a checkout stopped by uncommitted changes', () => {
  it('says which files are in the way, and leaves everything as it was', async () => {
    writeFileSync(join(dir, 'shared data.asset'), 'local\n')
    writeFileSync(join(dir, 'new.txt'), 'untracked here\n')

    const block = await repo.checkout(dir, 'other')

    expect(block).toMatchObject({ changed: ['shared data.asset'], untracked: ['new.txt'], folders: [] })
    expect(block?.message).toContain('would be overwritten by checkout')
    expect(await head()).toBe('main')
    expect(readFileSync(join(dir, 'shared data.asset'), 'utf8')).toBe('local\n')
  })

  it('is nothing when the checkout went through', async () => {
    writeFileSync(join(dir, 'unrelated.txt'), 'comes along\n')
    expect(await repo.checkout(dir, 'other')).toBeNull()
    expect(await head()).toBe('other')
  })

  it('stops a checkout of a remote branch or of a commit alike', async () => {
    const tip = (await git(['rev-parse', 'other'], { cwd: dir })).stdout.trim()
    await git(['update-ref', 'refs/remotes/origin/feature', tip], { cwd: dir })
    await git(['remote', 'add', 'origin', 'https://example.com/r.git'], { cwd: dir })
    writeFileSync(join(dir, 'shared data.asset'), 'local\n')

    expect(await repo.checkoutRemote(dir, 'origin/feature')).toMatchObject({ changed: ['shared data.asset'] })
    expect(await repo.checkoutDetached(dir, tip)).toMatchObject({ changed: ['shared data.asset'] })
    expect(await head()).toBe('main')
    // The branch it would have created is not left behind.
    expect((await git(['branch', '--list', 'feature'], { cwd: dir })).stdout.trim()).toBe('')
  })

  it('still fails for any other reason', async () => {
    await expect(repo.checkout(dir, 'nope')).rejects.toThrow()
  })

  it('goes through once the files in the way are put back as HEAD has them', async () => {
    writeFileSync(join(dir, 'shared data.asset'), 'local\n')
    await repo.stage(dir, ['shared data.asset'])
    writeFileSync(join(dir, 'shared data.asset'), 'local, more\n')
    writeFileSync(join(dir, 'new.txt'), 'untracked here\n')
    writeFileSync(join(dir, 'keep.txt'), 'not in the way\n')

    await repo.restoreFromHead(dir, ['shared data.asset'], ['new.txt'])

    expect(readFileSync(join(dir, 'shared data.asset'), 'utf8')).toBe('base\n')
    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    expect(await repo.checkout(dir, 'other')).toBeNull()
    expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('not in the way\n')
  })

  it('drops a file only staged when it is in the way', async () => {
    writeFileSync(join(dir, 'new.txt'), 'staged here\n')
    await repo.stage(dir, ['new.txt'])
    expect(await repo.checkout(dir, 'other')).toMatchObject({ changed: ['new.txt'] })

    await repo.restoreFromHead(dir, ['new.txt'], [])

    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    expect(await repo.checkout(dir, 'other')).toBeNull()
  })

  it('names a folder whose untracked files are in the way', async () => {
    // On file-folder, `folder` is a file; here it is a folder of untracked files.
    await repo.createBranch(dir, 'file-folder', null, true)
    await commitFile('folder', 'a file\n', 'folder is a file')
    await repo.checkout(dir, 'main')
    mkdirSync(join(dir, 'folder'))
    writeFileSync(join(dir, 'folder', 'untracked.txt'), 'x\n')

    expect(await repo.checkout(dir, 'file-folder')).toMatchObject({ changed: [], untracked: [], folders: ['folder'] })
  })
})
