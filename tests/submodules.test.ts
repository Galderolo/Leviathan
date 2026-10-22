import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { getSubmodules, updateSubmodules } from '../src/main/git/submodules'
import { parseGitlinks, parseSubmoduleConfig } from '../src/shared/submodules'

describe('parseSubmoduleConfig', () => {
  it('reads names, paths and urls, names with dots and spaces included', () => {
    const out = [
      'submodule.libs/core.path\nlibs/core',
      'submodule.libs/core.url\nhttps://example.com/core.git',
      'submodule.my lib.v2.path\nthird party/my lib',
      'submodule.my lib.v2.url\n../mylib.git',
      'submodule.nourl.path\nnourl',
      ''
    ].join('\0')
    expect(parseSubmoduleConfig(out)).toEqual([
      { name: 'libs/core', path: 'libs/core', url: 'https://example.com/core.git' },
      { name: 'my lib.v2', path: 'third party/my lib', url: '../mylib.git' },
      { name: 'nourl', path: 'nourl', url: '' }
    ])
  })
})

describe('parseGitlinks', () => {
  it('keeps submodule entries of the index, and marks conflicts', () => {
    const out = [
      '100644 aaaa 0\tREADME.md',
      '160000 1111111111111111111111111111111111111111 0\tlibs/core',
      '160000 2222222222222222222222222222222222222222 1\tthird party/my lib',
      '160000 3333333333333333333333333333333333333333 2\tthird party/my lib',
      ''
    ].join('\0')
    const links = parseGitlinks(out)
    expect(links.get('libs/core')).toEqual({ hash: '1111111111111111111111111111111111111111', conflict: false })
    expect(links.get('third party/my lib')?.conflict).toBe(true)
    expect(links.has('README.md')).toBe(false)
  })
})

let root: string
let lib: string
let work: string
const savedGlobal = process.env.GIT_CONFIG_GLOBAL

beforeAll(() => {
  // Local submodule URLs need the file protocol, which git refuses by default for submodules.
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-sub-global-'))
  process.env.GIT_CONFIG_GLOBAL = join(dir, 'global.gitconfig')
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[protocol "file"]\n\tallow = always\n')
})

afterAll(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal
})

async function configure(dir: string) {
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
}

async function commitFile(dir: string, name: string, message: string) {
  writeFileSync(join(dir, name), `${message}\n`)
  await git(['add', '--', name], { cwd: dir })
  await git(['commit', '-q', '-m', message], { cwd: dir })
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-sub-'))
  lib = await repo.initRepo(join(root, 'lib'), 'main')
  await configure(lib)
  await commitFile(lib, 'lib.txt', 'lib one')
  const main = await repo.initRepo(join(root, 'main'), 'main')
  await configure(main)
  await commitFile(main, 'readme.txt', 'main')
  await git(['submodule', 'add', '-q', lib, 'libs/core'], { cwd: main })
  await git(['commit', '-q', '-m', 'add submodule'], { cwd: main })
  // A clone, where the submodule starts uninitialized.
  await git(['clone', '-q', main, join(root, 'work')], { cwd: root })
  work = join(root, 'work')
  await configure(work)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('submodules', () => {
  it('reports nothing in a repository without submodules', async () => {
    expect(await getSubmodules(lib)).toEqual([])
  })

  it('tells uninitialized, up to date, other commit and local changes apart', async () => {
    const [before] = await getSubmodules(work)
    expect(before).toMatchObject({
      name: 'libs/core',
      path: 'libs/core',
      url: lib,
      state: 'uninitialized',
      current: null
    })
    expect(before.recorded).toMatch(/^[0-9a-f]{40}$/)

    await updateSubmodules(work, null, () => {})
    const [clean] = await getSubmodules(work)
    expect(clean).toMatchObject({ state: 'clean', dirty: false, current: clean.recorded })

    const sub = join(work, 'libs', 'core')
    await configure(sub)
    const newer = await commitFile(sub, 'more.txt', 'lib two')
    const [moved] = await getSubmodules(work)
    expect(moved).toMatchObject({ state: 'outOfSync', current: newer })

    writeFileSync(join(sub, 'lib.txt'), 'edited\n')
    expect((await getSubmodules(work))[0].dirty).toBe(true)
  })

  it('puts a submodule back on the recorded commit, but not over local changes', async () => {
    await updateSubmodules(work, null, () => {})
    const sub = join(work, 'libs', 'core')
    await configure(sub)
    await commitFile(sub, 'more.txt', 'lib two')
    await updateSubmodules(work, ['libs/core'], () => {})
    expect((await getSubmodules(work))[0].state).toBe('clean')

    await git(['checkout', '-q', '-b', 'topic'], { cwd: sub })
    await commitFile(sub, 'lib.txt', 'lib three')
    writeFileSync(join(sub, 'lib.txt'), 'uncommitted\n')
    await expect(updateSubmodules(work, ['libs/core'], () => {})).rejects.toThrow()
    expect((await getSubmodules(work))[0].dirty).toBe(true)
  })

  it('refuses paths that are not submodules', async () => {
    await expect(updateSubmodules(work, ['readme.txt'], () => {})).rejects.toThrow(/submodule/i)
  })

  it('describes a submodule change as the commits it brings', async () => {
    await updateSubmodules(work, null, () => {})
    const sub = join(work, 'libs', 'core')
    await configure(sub)
    await commitFile(sub, 'more.txt', 'lib two')
    await commitFile(sub, 'third.txt', 'lib three')
    const diff = await repo.getDiff(work, { kind: 'unstaged', path: 'libs/core' })
    expect(diff.submodule).toMatchObject({ missing: false })
    expect(diff.submodule?.commits.map((c) => [c.subject, c.added])).toEqual([
      ['lib three', true],
      ['lib two', true]
    ])
  })

  it('says when the commits of a submodule change are not here', async () => {
    const diff = await repo.getDiff(work, {
      kind: 'commit',
      hash: (await git(['rev-parse', 'HEAD'], { cwd: work })).stdout.trim(),
      parent: (await git(['rev-parse', 'HEAD~1'], { cwd: work })).stdout.trim(),
      path: 'libs/core'
    })
    expect(diff.submodule).toMatchObject({ from: null, missing: true, commits: [] })
  })

  it('clones with the submodules when asked', async () => {
    const dest = join(root, 'with-subs')
    await repo.cloneRepo(join(root, 'main'), dest, () => {}, [], true)
    const [sub] = await getSubmodules(dest)
    expect(sub.state).toBe('clean')
  })
})
