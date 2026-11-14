import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixupInfo } from '../src/main/git/fixup'
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
