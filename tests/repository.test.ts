import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { buildPartialPatch } from '../src/shared/patch'

let dir: string

async function setup(path: string) {
  await git(['config', 'user.name', 'Test User'], { cwd: path })
  await git(['config', 'user.email', 'test@example.com'], { cwd: path })
  await git(['config', 'commit.gpgsign', 'false'], { cwd: path })
  await git(['config', 'tag.gpgsign', 'false'], { cwd: path })
  await git(['config', 'core.autocrlf', 'false'], { cwd: path })
}

async function commitFile(name: string, content: string, message: string) {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
}

beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'leviathan-test-'))
  dir = await repo.initRepo(join(base, 'repo'), 'main')
  await setup(dir)
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('repository', () => {
  it('handles an empty repository', async () => {
    const state = await repo.getState(dir)
    expect(state.head).toMatchObject({ branch: 'main', hash: null })
    expect(await repo.getLog(dir, 10)).toEqual({ commits: [], hasMore: false })
  })

  it('stages, unstages and commits files', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    let state = await repo.getState(dir)
    expect(state.status.unstaged).toEqual([{ path: 'a.txt', status: '?' }])

    await repo.stage(dir, ['a.txt'])
    state = await repo.getState(dir)
    expect(state.status.staged).toEqual([{ path: 'a.txt', status: 'A' }])

    // Unstaging in a repository without commits uses `git rm --cached`.
    await repo.unstage(dir, ['a.txt'])
    expect((await repo.getState(dir)).status.staged).toEqual([])

    await repo.stageAll(dir)
    await repo.commit(dir, 'First commit\n\nWith body', false)
    const { commits } = await repo.getLog(dir, 10)
    expect(commits).toHaveLength(1)
    expect(commits[0].subject).toBe('First commit')
    const details = await repo.getCommitDetails(dir, commits[0].hash)
    expect(details.message).toBe('First commit\n\nWith body')
    expect(details.files).toEqual([{ path: 'a.txt', status: 'A' }])
  })

  it('stages a single hunk through git apply', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    await commitFile('f.txt', lines.join('\n') + '\n', 'base')
    const changed = [...lines]
    changed[1] = 'CHANGED 2'
    changed[27] = 'CHANGED 28'
    writeFileSync(join(dir, 'f.txt'), changed.join('\n') + '\n')

    const diff = await repo.getDiff(dir, { kind: 'unstaged', path: 'f.txt' })
    expect(diff.hunks).toHaveLength(2)
    await repo.applyPatch(dir, diff.header + diff.hunks[0].patch, { cached: true, reverse: false })

    const staged = await repo.getDiff(dir, { kind: 'staged', path: 'f.txt' })
    expect(staged.hunks).toHaveLength(1)
    expect(staged.hunks[0].lines.some((l) => l.type === 'add' && l.text === 'CHANGED 2')).toBe(true)
    const unstaged = await repo.getDiff(dir, { kind: 'unstaged', path: 'f.txt' })
    expect(unstaged.hunks).toHaveLength(1)
    expect(unstaged.hunks[0].lines.some((l) => l.type === 'add' && l.text === 'CHANGED 28')).toBe(true)

    // Unstage it again with --reverse.
    await repo.applyPatch(dir, staged.header + staged.hunks[0].patch, { cached: true, reverse: true })
    expect((await repo.getState(dir)).status.staged).toEqual([])
  })

  it('loads the log of an orphan branch next to other branches', async () => {
    await commitFile('a.txt', 'a\n', 'on main')
    await git(['checkout', '-q', '--orphan', 'nueva'], { cwd: dir })
    const { commits } = await repo.getLog(dir, 10)
    expect(commits.map((c) => c.subject)).toEqual(['on main'])
  })

  it('reports unmerged branches in English regardless of locale', async () => {
    await commitFile('a.txt', 'a\n', 'base')
    await repo.createBranch(dir, 'side', null, true)
    await commitFile('b.txt', 'b\n', 'unmerged work')
    await repo.checkout(dir, 'main')
    const saved = { LANGUAGE: process.env.LANGUAGE, LANG: process.env.LANG }
    process.env.LANGUAGE = 'es'
    process.env.LANG = 'es_ES.UTF-8'
    try {
      await expect(repo.deleteBranch(dir, 'side', false)).rejects.toThrow(/not fully merged/)
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  it('does not follow untracked symlinks when previewing them', async (ctx) => {
    const secret = join(dir, '..', 'secret.txt')
    writeFileSync(secret, 'TOP SECRET\n')
    try {
      symlinkSync(secret, join(dir, 'link.txt'))
    } catch {
      ctx.skip() // Windows without Developer Mode cannot create symlinks.
    }
    const diff = await repo.getDiff(dir, { kind: 'unstaged', path: 'link.txt', untracked: true })
    expect(diff.binary).toBe(true)
    expect(JSON.stringify(diff)).not.toContain('TOP SECRET')
  })

  it('survives git exiting before reading stdin', async () => {
    const result = await git(['--version'], { cwd: dir, input: 'x'.repeat(8_000_000) })
    expect(result.stdout).toContain('git version')
  })

  it('treats file names literally, not as globs', async () => {
    writeFileSync(join(dir, '[id].tsx'), 'route\n')
    writeFileSync(join(dir, 'i.tsx'), 'i\n')
    writeFileSync(join(dir, 'd.tsx'), 'd\n')
    await repo.stageAll(dir)
    await repo.commit(dir, 'base', false)
    for (const f of ['[id].tsx', 'i.tsx', 'd.tsx']) writeFileSync(join(dir, f), 'changed\n')

    const diff = await repo.getDiff(dir, { kind: 'unstaged', path: '[id].tsx' })
    expect(diff.hunks).toHaveLength(1)

    await repo.discard(dir, ['[id].tsx'], [])
    expect(readFileSync(join(dir, '[id].tsx'), 'utf8')).toBe('route\n')
    expect(readFileSync(join(dir, 'i.tsx'), 'utf8')).toBe('changed\n')
    expect(readFileSync(join(dir, 'd.tsx'), 'utf8')).toBe('changed\n')
  })

  it('unstages both sides of a rename', async () => {
    await commitFile('old.txt', 'same content\n', 'base')
    await git(['mv', 'old.txt', 'new.txt'], { cwd: dir })
    let state = await repo.getState(dir)
    expect(state.status.staged).toEqual([{ path: 'new.txt', origPath: 'old.txt', status: 'R' }])
    await repo.unstage(dir, ['new.txt', 'old.txt'])
    state = await repo.getState(dir)
    expect(state.status.staged).toEqual([])
    expect(state.status.unstaged.map((f) => f.path).sort()).toEqual(['new.txt', 'old.txt'])
  })

  it('gives the whole file around the hunks of a diff when asked', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    await commitFile('f.txt', lines.join('\n') + '\n', 'base')
    lines[9] = 'changed 10'
    lines[19] = 'changed 20'
    writeFileSync(join(dir, 'f.txt'), lines.join('\n') + '\n')
    const gapNumbers = (gaps: { newNo?: number }[][] | undefined) => gaps?.map((gap) => gap.map((l) => l.newNo))
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    const expected = [range(1, 6), range(14, 16), range(24, 30)]

    const unstaged = await repo.getDiff(dir, { kind: 'unstaged', path: 'f.txt' }, true)
    expect(unstaged.hunks).toHaveLength(2)
    expect(gapNumbers(unstaged.gaps)).toEqual(expected)
    expect(unstaged.gaps?.[0][0].text).toBe('line 1')
    expect((await repo.getDiff(dir, { kind: 'unstaged', path: 'f.txt' })).gaps).toBeUndefined()

    await repo.stage(dir, ['f.txt'])
    expect(gapNumbers((await repo.getDiff(dir, { kind: 'staged', path: 'f.txt' }, true)).gaps)).toEqual(expected)

    await repo.commit(dir, 'change', false)
    const head = (await repo.getState(dir)).head.hash!
    // Without a parent: `git show`, where a near-INT_MAX context split the file into overlapping hunks.
    const commit = await repo.getDiff(dir, { kind: 'commit', hash: head, parent: null, path: 'f.txt' }, true)
    expect(gapNumbers(commit.gaps)).toEqual(expected)
  })

  it('stages and unstages individual lines', async () => {
    await commitFile('f.txt', 'one\ntwo\n', 'base')
    writeFileSync(join(dir, 'f.txt'), 'one\nfirst new\nsecond new\ntwo\n')
    const diff = await repo.getDiff(dir, { kind: 'unstaged', path: 'f.txt' })
    const hunk = diff.hunks[0]
    const second = hunk.lines.findIndex((l) => l.text === 'second new')
    await repo.applyPatch(dir, buildPartialPatch(diff.header, hunk, new Set([second]), false)!, {
      cached: true,
      reverse: false
    })

    const staged = await repo.getDiff(dir, { kind: 'staged', path: 'f.txt' })
    expect(staged.hunks[0].lines.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['second new'])

    const back = staged.hunks[0].lines.findIndex((l) => l.text === 'second new')
    await repo.applyPatch(dir, buildPartialPatch(staged.header, staged.hunks[0], new Set([back]), true)!, {
      cached: true,
      reverse: true
    })
    expect((await repo.getState(dir)).status.staged).toEqual([])
  })

  it('discards tracked and untracked changes', async () => {
    await commitFile('a.txt', 'one\n', 'base')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    writeFileSync(join(dir, 'new.txt'), 'x\n')
    await repo.discard(dir, ['a.txt'], ['new.txt'])
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\n')
    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    await expect(repo.discard(dir, [], ['../escape.txt'])).rejects.toThrow(/outside the repository/)
  })

  it('creates, checks out, merges and deletes branches', async () => {
    await commitFile('a.txt', 'a\n', 'base')
    await repo.createBranch(dir, 'feature/x', null, true)
    await commitFile('b.txt', 'b\n', 'feature work')
    await repo.checkout(dir, 'main')
    await commitFile('c.txt', 'c\n', 'main work')
    await repo.merge(dir, 'feature/x')

    const state = await repo.getState(dir)
    expect(state.head.branch).toBe('main')
    expect(
      state.refs
        .filter((r) => r.type === 'head')
        .map((r) => r.name)
        .sort()
    ).toEqual(['feature/x', 'main'])
    const { commits } = await repo.getLog(dir, 10)
    expect(commits[0].parents).toHaveLength(2)

    await repo.renameBranch(dir, 'feature/x', 'feature/y')
    await repo.deleteBranch(dir, 'feature/y', false)
    expect((await repo.getState(dir)).refs.filter((r) => r.type === 'head')).toHaveLength(1)
    await expect(repo.createBranch(dir, 'bad..name', null, false)).rejects.toThrow(/not a valid branch name/)
    await expect(repo.createBranch(dir, '-x', null, false)).rejects.toThrow(/Invalid branch name/)
  })

  it('reports merge conflicts and aborts them', async () => {
    await commitFile('a.txt', 'base\n', 'base')
    await repo.createBranch(dir, 'other', null, true)
    await commitFile('a.txt', 'other\n', 'other change')
    await repo.checkout(dir, 'main')
    await commitFile('a.txt', 'main\n', 'main change')
    await expect(repo.merge(dir, 'other')).rejects.toThrow()

    const state = await repo.getState(dir)
    expect(state.operation).toBe('merge')
    expect(state.status.conflicted).toEqual([{ path: 'a.txt', status: 'U' }])
    const diff = await repo.getDiff(dir, { kind: 'unstaged', path: 'a.txt', conflicted: true })
    expect(diff.hunks[0].lines.some((l) => l.text.startsWith('<<<<<<<'))).toBe(true)

    await repo.abortOperation(dir)
    expect((await repo.getState(dir)).operation).toBeNull()
  })

  it('refuses to touch a stash that moved', async () => {
    await commitFile('a.txt', 'a\n', 'base')
    writeFileSync(join(dir, 'a.txt'), 'first\n')
    await repo.stashSave(dir, 'first')
    const first = (await repo.getState(dir)).stashes[0]
    writeFileSync(join(dir, 'a.txt'), 'second\n')
    await repo.stashSave(dir, 'second')

    // The UI still believes "first" is stash@{0}.
    await expect(repo.stashDrop(dir, 0, first.hash)).rejects.toThrow(/stash list changed/i)
    await expect(repo.stashPop(dir, 0, first.hash)).rejects.toThrow(/stash list changed/i)
    expect((await repo.getState(dir)).stashes.map((s) => s.message)).toEqual(['On main: second', 'On main: first'])
  })

  it('saves, lists and pops stashes', async () => {
    await commitFile('a.txt', 'a\n', 'base')
    writeFileSync(join(dir, 'a.txt'), 'changed\n')
    writeFileSync(join(dir, 'untracked.txt'), 'u\n')
    await repo.stashSave(dir, 'my stash')
    let state = await repo.getState(dir)
    expect(state.stashes).toHaveLength(1)
    expect(state.stashes[0].message).toContain('my stash')
    expect(state.status.unstaged).toEqual([])

    await repo.stashPop(dir, 0, state.stashes[0].hash)
    state = await repo.getState(dir)
    expect(state.stashes).toHaveLength(0)
    expect(state.status.unstaged.map((f) => f.path).sort()).toEqual(['a.txt', 'untracked.txt'])
  })

  it('creates tags, resets and amends', async () => {
    await commitFile('a.txt', 'a\n', 'one')
    await commitFile('a.txt', 'b\n', 'two')
    const { commits } = await repo.getLog(dir, 10)
    await repo.createTag(dir, 'v1.0', commits[1].hash, 'Release 1')
    let state = await repo.getState(dir)
    expect(state.refs.find((r) => r.type === 'tag')).toMatchObject({ name: 'v1.0', hash: commits[1].hash })

    await repo.commit(dir, 'two (amended)', true)
    expect(await repo.headMessage(dir)).toBe('two (amended)')

    await repo.reset(dir, commits[1].hash, 'hard')
    state = await repo.getState(dir)
    expect(state.head.hash).toBe(commits[1].hash)
    await repo.deleteTag(dir, 'v1.0')
    expect((await repo.getState(dir)).refs.some((r) => r.type === 'tag')).toBe(false)
  })

  it('passes extra git arguments to clone (used for account credentials)', async () => {
    const remoteDir = join(dir, '..', 'remote.git')
    await git(['init', '-q', '--bare', '--initial-branch=main', remoteDir], { cwd: join(dir, '..') })
    const url = pathToFileURL(remoteDir).href
    await expect(
      repo.cloneRepo(url, join(dir, '..', 'blocked'), () => {}, ['-c', 'protocol.file.allow=never'])
    ).rejects.toThrow()
    await expect(repo.cloneRepo(url, join(dir, '..', 'allowed'), () => {}, [])).resolves.toContain('allowed')
  })

  it('publishes a new branch to the chosen remote', async () => {
    const parent = join(dir, '..')
    for (const name of ['origin.git', 'fork.git']) {
      await git(['init', '-q', '--bare', '--initial-branch=main', join(parent, name)], { cwd: parent })
    }
    await commitFile('a.txt', 'a\n', 'base')
    await repo.addRemote(dir, 'origin', join(parent, 'origin.git'))
    await repo.addRemote(dir, 'fork', join(parent, 'fork.git'))
    await repo.createBranch(dir, 'topic', null, true)
    await repo.push(dir, { force: false, remote: 'fork' }, () => {})

    const inFork = await git(['rev-parse', '--verify', 'refs/heads/topic'], {
      cwd: join(parent, 'fork.git'),
      okCodes: [0, 128]
    })
    const inOrigin = await git(['rev-parse', '--verify', 'refs/heads/topic'], {
      cwd: join(parent, 'origin.git'),
      okCodes: [0, 128]
    })
    expect([inFork.exitCode, inOrigin.exitCode]).toEqual([0, 128])
    expect((await repo.getState(dir)).head.upstream).toBe('fork/topic')
  })

  it('never pushes a branch onto a differently named upstream', async () => {
    const remoteDir = join(dir, '..', 'remote.git')
    await git(['init', '-q', '--bare', '--initial-branch=main', remoteDir], { cwd: join(dir, '..') })
    await commitFile('a.txt', 'a\n', 'base')
    await repo.addRemote(dir, 'origin', remoteDir)
    await repo.push(dir, { force: false }, () => {})
    const mainBefore = (await git(['rev-parse', 'main'], { cwd: remoteDir })).stdout.trim()

    // Starting a branch from origin/main makes origin/main its upstream.
    await git(['checkout', '-q', '-b', 'feature', 'origin/main'], { cwd: dir })
    await commitFile('b.txt', 'b\n', 'feature work')
    await repo.push(dir, { force: false }, () => {})

    expect((await git(['rev-parse', 'main'], { cwd: remoteDir })).stdout.trim()).toBe(mainBefore)
    const feature = await git(['rev-parse', '--verify', 'refs/heads/feature'], { cwd: remoteDir, okCodes: [0, 128] })
    expect(feature.exitCode).toBe(0)
    // A first publish tracks the published branch, as `git push -u` would.
    expect((await repo.getState(dir)).head.upstream).toBe('origin/feature')
  })

  it('keeps an upstream set on purpose once the branch is published', async () => {
    const remoteDir = join(dir, '..', 'remote.git')
    await git(['init', '-q', '--bare', '--initial-branch=main', remoteDir], { cwd: join(dir, '..') })
    await commitFile('a.txt', 'a\n', 'base')
    await repo.addRemote(dir, 'origin', remoteDir)
    await repo.push(dir, { force: false }, () => {})
    const mainBefore = (await git(['rev-parse', 'main'], { cwd: remoteDir })).stdout.trim()
    await repo.createBranch(dir, 'feature', null, true)
    await commitFile('b.txt', 'b\n', 'feature work')
    await repo.push(dir, { force: false }, () => {})

    await git(['branch', '-q', '--set-upstream-to=origin/main'], { cwd: dir })
    await commitFile('c.txt', 'c\n', 'more work')
    await repo.push(dir, { force: false }, () => {})

    const tip = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    expect((await git(['rev-parse', 'feature'], { cwd: remoteDir })).stdout.trim()).toBe(tip)
    expect((await git(['rev-parse', 'main'], { cwd: remoteDir })).stdout.trim()).toBe(mainBefore)
    expect((await repo.getState(dir)).head.upstream).toBe('origin/main')
  })

  it('tracks the published branch again when the upstream it had is gone', async () => {
    const remoteDir = join(dir, '..', 'remote.git')
    await git(['init', '-q', '--bare', '--initial-branch=main', remoteDir], { cwd: join(dir, '..') })
    await commitFile('a.txt', 'a\n', 'base')
    await repo.addRemote(dir, 'origin', remoteDir)
    await repo.push(dir, { force: false }, () => {})
    await git(['push', '-q', 'origin', 'main:develop'], { cwd: dir })
    await repo.createBranch(dir, 'feature', null, true)
    await repo.push(dir, { force: false }, () => {})
    await git(['branch', '-q', '--set-upstream-to=origin/develop'], { cwd: dir })
    await git(['push', '-q', 'origin', '--delete', 'develop'], { cwd: dir })

    await commitFile('b.txt', 'b\n', 'feature work')
    await repo.push(dir, { force: false }, () => {})
    expect((await repo.getState(dir)).head.upstream).toBe('origin/feature')
  })

  it('pushes a published branch to the remote that has it, not to the remote of its upstream', async () => {
    const parent = join(dir, '..')
    for (const name of ['origin.git', 'upstream.git']) {
      await git(['init', '-q', '--bare', '--initial-branch=main', join(parent, name)], { cwd: parent })
    }
    await commitFile('a.txt', 'a\n', 'base')
    await repo.addRemote(dir, 'origin', join(parent, 'origin.git'))
    await repo.addRemote(dir, 'upstream', join(parent, 'upstream.git'))
    await git(['push', '-q', 'upstream', 'main'], { cwd: dir })
    await repo.createBranch(dir, 'feature', null, true)
    await repo.push(dir, { force: false, remote: 'origin' }, () => {})
    // A fork's branch that follows the original repository's main.
    await git(['branch', '-q', '--set-upstream-to=upstream/main'], { cwd: dir })

    await commitFile('b.txt', 'b\n', 'feature work')
    await repo.push(dir, { force: false }, () => {})

    const tip = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    expect((await git(['rev-parse', 'feature'], { cwd: join(parent, 'origin.git') })).stdout.trim()).toBe(tip)
    const inUpstream = await git(['rev-parse', '--verify', 'refs/heads/feature'], {
      cwd: join(parent, 'upstream.git'),
      okCodes: [0, 128]
    })
    expect(inUpstream.exitCode).toBe(128)
    expect((await repo.getState(dir)).head.upstream).toBe('upstream/main')
  })

  it('pushes to and pulls from a remote', async () => {
    const remoteDir = join(dir, '..', 'remote.git')
    await git(['init', '-q', '--bare', '--initial-branch=main', remoteDir], { cwd: join(dir, '..') })
    await commitFile('a.txt', 'a\n', 'base')
    await repo.addRemote(dir, 'origin', remoteDir)
    const lines: string[] = []
    await repo.push(dir, { force: false }, (l) => lines.push(l))

    let state = await repo.getState(dir)
    expect(state.head.upstream).toBe('origin/main')
    expect(state.refs.some((r) => r.type === 'remote' && r.name === 'origin/main')).toBe(true)

    const clone = await repo.cloneRepo(remoteDir, join(dir, '..', 'clone'), () => {})
    await setup(clone)
    writeFileSync(join(clone, 'b.txt'), 'b\n')
    await repo.stageAll(clone)
    await repo.commit(clone, 'from clone', false)
    await repo.push(clone, { force: false }, () => {})

    await repo.fetchAll(dir, () => {})
    state = await repo.getState(dir)
    expect(state.head.behind).toBe(1)
    await repo.pull(dir, 'ff-only', () => {})
    state = await repo.getState(dir)
    expect(state.head.behind).toBe(0)
    expect(existsSync(join(dir, 'b.txt'))).toBe(true)
  })
})
