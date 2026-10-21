import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

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
  const base = mkdtempSync(join(tmpdir(), 'calamar-test-'))
  dir = await repo.initRepo(join(base, 'repo'), 'main')
  await setup(dir)
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
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

  it('saves, lists and pops stashes', async () => {
    await commitFile('a.txt', 'a\n', 'base')
    writeFileSync(join(dir, 'a.txt'), 'changed\n')
    writeFileSync(join(dir, 'untracked.txt'), 'u\n')
    await repo.stashSave(dir, 'my stash')
    let state = await repo.getState(dir)
    expect(state.stashes).toHaveLength(1)
    expect(state.stashes[0].message).toContain('my stash')
    expect(state.status.unstaged).toEqual([])

    await repo.stashPop(dir, 0)
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
