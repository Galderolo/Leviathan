import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import type { RebaseItem } from '../src/shared/rebase'

let dir: string
let base: string
const hashes: Record<string, string> = {}

async function commitFile(name: string, content: string, message: string) {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

const messages = async () =>
  (await git(['log', '--format=%B%x00', `${base}..HEAD`], { cwd: dir })).stdout
    .split('\0')
    .map((m) => m.trim())
    .filter(Boolean)
const pick = (name: string, action: RebaseItem['action'] = 'pick', message?: string): RebaseItem => ({
  hash: hashes[name],
  action,
  message
})

/** A repository at `path` with `base` and then commits one, two, three. */
async function setup(path: string) {
  dir = await repo.initRepo(path, 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
  base = await commitFile('base.txt', 'base\n', 'base')
  for (const name of ['one', 'two', 'three']) hashes[name] = await commitFile(`${name}.txt`, `${name}\n`, name)
}

beforeEach(() => setup(join(mkdtempSync(join(tmpdir(), 'leviathan-rebase-')), 'repo')))

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

describe('getRebaseCommits', () => {
  it('lists the commits after the base, oldest first', async () => {
    const commits = await repo.getRebaseCommits(dir, base)
    expect(commits.map((c) => c.subject)).toEqual(['one', 'two', 'three'])
    expect(commits[0].hash).toBe(hashes.one)
  })

  it('refuses a range with merge commits', async () => {
    await repo.createBranch(dir, 'side', base, true)
    await commitFile('side.txt', 'side\n', 'side')
    await repo.checkout(dir, 'main')
    await repo.merge(dir, 'side')
    await expect(repo.getRebaseCommits(dir, base)).rejects.toThrow(/merge/)
  })
})

describe('interactiveRebase', () => {
  it('reorders commits', async () => {
    await repo.interactiveRebase(dir, base, [pick('two'), pick('one'), pick('three')])
    expect(await messages()).toEqual(['three', 'one', 'two'])
    for (const name of ['one', 'two', 'three']) expect(existsSync(join(dir, `${name}.txt`))).toBe(true)
  })

  it('squashes keeping both messages, and fixes up keeping only the first', async () => {
    await repo.interactiveRebase(dir, base, [pick('one'), pick('two', 'squash'), pick('three', 'fixup')])
    expect(await messages()).toEqual(['one\n\ntwo'])
  })

  it('drops a commit', async () => {
    await repo.interactiveRebase(dir, base, [pick('one'), pick('two', 'drop'), pick('three')])
    expect(await messages()).toEqual(['three', 'one'])
    expect(existsSync(join(dir, 'two.txt'))).toBe(false)
  })

  it('rewords a commit with the message exactly as typed', async () => {
    const message = 'Fix "quotes" and it\'s $HOME\n\n# not a comment'
    await repo.interactiveRebase(dir, base, [pick('one', 'reword', message), pick('two'), pick('three')])
    expect(await messages()).toEqual(['three', 'two', message])
  })

  it('works when the repository path has spaces and quotes', async () => {
    await setup(join(dir, '..', "it's a repo"))
    await repo.interactiveRebase(dir, base, [pick('two'), pick('one', 'reword', 'One!'), pick('three')])
    expect(await messages()).toEqual(['three', 'One!', 'two'])
  })

  it('refuses a list read before the branch changed', async () => {
    const items = [pick('one'), pick('two'), pick('three')]
    const head = await commitFile('four.txt', 'four\n', 'four')
    await expect(repo.interactiveRebase(dir, base, items)).rejects.toThrow(/changed/)
    expect((await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()).toBe(head)
  })

  it('refuses with uncommitted changes to tracked files', async () => {
    writeFileSync(join(dir, 'one.txt'), 'edited\n')
    await expect(repo.interactiveRebase(dir, base, [pick('two'), pick('one'), pick('three')])).rejects.toThrow(
      /uncommitted|stash/i
    )
    expect(await messages()).toEqual(['three', 'two', 'one'])
  })

  it('refuses unknown actions', async () => {
    const items = [pick('one'), pick('two'), { hash: hashes.three, action: 'exec' as RebaseItem['action'] }]
    await expect(repo.interactiveRebase(dir, base, items)).rejects.toThrow()
    expect(await messages()).toEqual(['three', 'two', 'one'])
  })

  it('never moves a reword onto another commit when the reworded one ends up empty', async () => {
    hashes.four = await commitFile('one.txt', 'four\n', 'four')
    await expect(
      repo.interactiveRebase(dir, base, [
        pick('one', 'drop'),
        pick('two'),
        pick('three'),
        pick('four', 'reword', 'Four, reworded')
      ])
    ).rejects.toThrow()
    // Keep the current side: one.txt stays deleted, so "four" changes nothing and is dropped.
    await git(['rm', '-q', 'one.txt'], { cwd: dir })
    await repo.continueOperation(dir)
    expect((await repo.getState(dir)).operation).toBeNull()
    expect(await messages()).toEqual(['three', 'two'])
  })

  it('runs a reword that failed again when continuing', async () => {
    // Signing fails, so the amend that rewords "three" fails once (the picks before it fast-forward,
    // so nothing else needs signing; rebase remembers the signing setting for its own commits).
    await git(['config', 'commit.gpgsign', 'true'], { cwd: dir })
    await git(['config', 'gpg.program', 'leviathan-no-such-gpg'], { cwd: dir })
    await expect(
      repo.interactiveRebase(dir, base, [pick('one'), pick('two'), pick('three', 'reword', 'THREE')])
    ).rejects.toThrow()
    expect((await repo.getState(dir)).operation).toBe('rebase')
    await git(['config', 'commit.gpgsign', 'false'], { cwd: dir })
    await repo.continueOperation(dir)
    expect(await messages()).toEqual(['THREE', 'two', 'one'])
  })

  it('keeps messages exactly whatever the commit cleanup and comment settings', async () => {
    await git(['config', 'commit.cleanup', 'strip'], { cwd: dir })
    await git(['config', 'core.commentChar', 'auto'], { cwd: dir })
    await repo.interactiveRebase(dir, base, [
      pick('one', 'reword', 'One\n\n# kept'),
      pick('two', 'squash'),
      pick('three')
    ])
    expect(await messages()).toEqual(['three', 'One\n\n# kept\n\ntwo'])
  })

  it('stops on a conflict and applies the reword after continuing', async () => {
    hashes.four = await commitFile('one.txt', 'four\n', 'four')
    await expect(
      repo.interactiveRebase(dir, base, [
        pick('one', 'drop'),
        pick('two'),
        pick('three'),
        pick('four', 'reword', 'Four, reworded')
      ])
    ).rejects.toThrow()
    expect((await repo.getState(dir)).operation).toBe('rebase')

    writeFileSync(join(dir, 'one.txt'), 'four\n')
    await repo.stage(dir, ['one.txt'])
    await repo.continueOperation(dir)
    expect((await repo.getState(dir)).operation).toBeNull()
    expect(await messages()).toEqual(['Four, reworded', 'three', 'two'])
  })
})

describe('leftover files', () => {
  const leftovers = async () =>
    existsSync(join((await git(['rev-parse', '--absolute-git-dir'], { cwd: dir })).stdout.trim(), 'leviathan-rebase'))

  it('are removed when the rebase finishes', async () => {
    await repo.interactiveRebase(dir, base, [pick('one', 'reword', 'One'), pick('two'), pick('three')])
    expect(await leftovers()).toBe(false)
  })

  it('stay while the rebase is stopped, and go once it is continued or aborted', async () => {
    hashes.four = await commitFile('one.txt', 'four\n', 'four')
    const conflicting = [pick('one', 'drop'), pick('two'), pick('three'), pick('four', 'reword', 'Four!')]
    await expect(repo.interactiveRebase(dir, base, conflicting)).rejects.toThrow()
    expect(await leftovers()).toBe(true)
    await repo.abortOperation(dir)
    expect(await leftovers()).toBe(false)

    await expect(repo.interactiveRebase(dir, base, conflicting)).rejects.toThrow()
    writeFileSync(join(dir, 'one.txt'), 'four\n')
    await repo.stage(dir, ['one.txt'])
    await repo.continueOperation(dir)
    expect(await leftovers()).toBe(false)
  })
})
