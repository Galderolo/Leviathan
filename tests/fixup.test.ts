import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixupCommit, fixupInfo } from '../src/main/git/fixup'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { pendingFixup } from '../src/shared/fixup'

let dir: string
const hashes: Record<string, string> = {}

const out = async (...args: string[]) => (await git(args, { cwd: dir })).stdout.trim()
const head = () => out('rev-parse', 'HEAD')
const subjects = async () => (await out('log', '--format=%s')).split('\n')
const staged = () => out('diff', '--cached', '--name-only')

async function commitFile(name: string, content: string, message: string): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return head()
}

async function stageFile(name: string, content: string): Promise<void> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
}

/** A hook that says no (git runs hooks through its own sh, on Windows too), in a folder of the test's own. */
async function failingHook(name: string): Promise<void> {
  const hooks = join(dir, '..', 'hooks')
  mkdirSync(hooks, { recursive: true })
  writeFileSync(join(hooks, name), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  await git(['config', 'core.hooksPath', hooks.replace(/\\/g, '/')], { cwd: dir })
}

/** A repository with commits base, one, two, three, each adding `<name>.txt`. */
beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-fixup-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
  hashes.base = await commitFile('base.txt', 'base\n', 'base')
  for (const name of ['one', 'two', 'three']) hashes[name] = await commitFile(`${name}.txt`, `${name}\n`, name)
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('pendingFixup', () => {
  it('finds the subjects that autosquash melds into another commit', () => {
    expect(pendingFixup(['two', 'fixup! one'])).toBe(true)
    expect(pendingFixup(['squash! one'])).toBe(true)
    expect(pendingFixup(['amend! one'])).toBe(true)
    expect(pendingFixup(['one', 'fixup one', 'a fixup! here'])).toBe(false)
  })
})

describe('fixupInfo', () => {
  it('gives the subject of the commit, with nothing published without a remote', async () => {
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: true, subject: 'one', published: 0 })
  })

  it('counts the commits to rewrite that are already on a remote', async () => {
    const origin = join(dir, '..', 'origin.git')
    await git(['init', '-q', '--bare', origin], { cwd: join(dir, '..') })
    await git(['remote', 'add', 'origin', origin], { cwd: dir })
    await git(['push', '-q', 'origin', `${hashes.two}:refs/heads/main`], { cwd: dir })
    await git(['fetch', '-q', 'origin'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    // one, two and three are rewritten; one and two are on origin.
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: true, subject: 'one', published: 2 })
    expect(await fixupInfo(dir, hashes.three)).toEqual({ ok: true, subject: 'three', published: 0 })
  })

  it('refuses when nothing is staged', async () => {
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'nothingStaged' })
  })

  it('refuses a commit that is not on the current branch', async () => {
    await git(['checkout', '-q', '-b', 'side', hashes.base], { cwd: dir })
    const side = await commitFile('side.txt', 'side\n', 'side')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, side)).toEqual({ ok: false, reason: 'notAncestor' })
    expect(await fixupInfo(dir, 'no-such-commit')).toEqual({ ok: false, reason: 'notAncestor' })
  })

  it('refuses when a merge comes after the commit, not once past it', async () => {
    await git(['checkout', '-q', '-b', 'side', hashes.one], { cwd: dir })
    await commitFile('side.txt', 'side\n', 'side')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    await git(['merge', '-q', '--no-ff', '-m', 'merge side', 'side'], { cwd: dir })
    const four = await commitFile('four.txt', 'four\n', 'four')
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'merges' })
    expect(await fixupInfo(dir, four)).toEqual({ ok: true, subject: 'four', published: 0 })
  })

  it('refuses when fixup or squash commits wait after the commit', async () => {
    await commitFile('two.txt', 'two\nlater\n', 'fixup! two')
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'pendingFixups' })
  })

  it('refuses while an operation or a bisect is under way', async () => {
    await git(['checkout', '-q', '-b', 'side', hashes.base], { cwd: dir })
    const side = await commitFile('one.txt', 'side\n', 'side')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    await git(['cherry-pick', side], { cwd: dir, okCodes: [0, 1] })
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'operation' })
    await git(['cherry-pick', '--abort'], { cwd: dir })
    await git(['bisect', 'start', 'HEAD', hashes.base], { cwd: dir })
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'operation' })
  })
})

describe('fixupCommit', () => {
  it('adds the staged changes to an older commit, leaving the later ones and every message as they were', async () => {
    await stageFile('one.txt', 'one\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.one)
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
    expect(hash).toBe(await out('rev-parse', 'HEAD~2'))
    expect(await out('show', `${hash}:one.txt`)).toBe('one\nmore')
    expect(await out('diff', '--name-only', hashes.three, 'HEAD')).toBe('one.txt')
    expect(await out('status', '--porcelain')).toBe('')
    expect((await repo.getState(dir)).operation).toBeNull()
  })

  it('leaves unstaged changes and untracked files where they were', async () => {
    await stageFile('one.txt', 'one\nmore\n')
    writeFileSync(join(dir, 'two.txt'), 'two\nlocal\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await fixupCommit(dir, hashes.one)
    expect(readFileSync(join(dir, 'two.txt'), 'utf8')).toBe('two\nlocal\n')
    expect(readFileSync(join(dir, 'new.txt'), 'utf8')).toBe('new\n')
    expect(await staged()).toBe('')
    expect(await out('diff', '--name-only')).toBe('two.txt')
    expect(await out('stash', 'list')).toBe('')
  })

  it('adds them to the root commit', async () => {
    await stageFile('base.txt', 'base\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.base)
    expect(hash).toBe(await out('rev-list', '--max-parents=0', 'HEAD'))
    expect(await out('show', `${hash}:base.txt`)).toBe('base\nmore')
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
  })

  it('adds them to the commit checked out', async () => {
    await stageFile('three.txt', 'three\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.three)
    expect(hash).toBe(await head())
    expect(await out('show', 'HEAD:three.txt')).toBe('three\nmore')
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
  })

  it('adds them to the older of two commits with the same subject', async () => {
    await commitFile('four.txt', 'four\n', 'one')
    await stageFile('one.txt', 'one\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.one)
    expect(hash).toBe(await out('rev-parse', 'HEAD~3'))
    expect(await out('show', `${hash}:one.txt`)).toBe('one\nmore')
    expect(await out('diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('four.txt')
  })

  it('changes nothing when it is refused', async () => {
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow('Nothing is staged.')
    expect(await head()).toBe(before)
  })

  it('changes nothing when a commit hook says no', async () => {
    await failingHook('pre-commit')
    await stageFile('one.txt', 'one\nmore\n')
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow()
    expect(await head()).toBe(before)
    expect(await staged()).toBe('one.txt')
  })

  it('stages the changes again when the rebase does not start', async () => {
    await failingHook('pre-rebase')
    await stageFile('one.txt', 'one\nmore\n')
    writeFileSync(join(dir, 'two.txt'), 'two\nlocal\n')
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow(/pre-rebase/)
    expect(await head()).toBe(before)
    expect(await staged()).toBe('one.txt')
    expect(readFileSync(join(dir, 'two.txt'), 'utf8')).toBe('two\nlocal\n')
    expect((await repo.getState(dir)).operation).toBeNull()
  })

  it('is not held up by a sequence editor in the config', async () => {
    await git(['config', 'sequence.editor', 'false'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    await fixupCommit(dir, hashes.one)
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
  })

  it('puts everything back when git cannot tell which commit the changes are for', async () => {
    // A commit without a message: "fixup! " matches nothing, and git keeps the fixup commit as one of its own.
    writeFileSync(join(dir, 'four.txt'), 'four\n')
    await repo.stage(dir, ['four.txt'])
    await git(['commit', '-q', '--allow-empty-message', '-m', ''], { cwd: dir })
    const empty = await head()
    await commitFile('five.txt', 'five\n', 'five')
    await stageFile('four.txt', 'four\nmore\n')
    const before = await head()
    await expect(fixupCommit(dir, empty)).rejects.toThrow('git could not add the changes to that commit.')
    expect(await head()).toBe(before)
    expect(await staged()).toBe('four.txt')
    expect(await out('diff', '--cached')).toContain('+more')
  })

  it('signs nothing when told not to, after signing failed', async () => {
    await git(['config', 'commit.gpgsign', 'true'], { cwd: dir })
    await git(['config', 'gpg.program', 'leviathan-no-such-gpg'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow(/gpg failed to sign/)
    expect(await head()).toBe(before)
    expect(await staged()).toBe('one.txt')
    await fixupCommit(dir, hashes.one, true)
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
    expect(await out('show', 'HEAD~2:one.txt')).toBe('one\nmore')
  })
})
