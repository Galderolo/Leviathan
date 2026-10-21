import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let root: string
let work: string

async function commitFile(name: string, message: string) {
  writeFileSync(join(work, name), `${name}\n`)
  await repo.stage(work, [name])
  await repo.commit(work, message, false)
  return (await git(['rev-parse', 'HEAD'], { cwd: work })).stdout.trim()
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-unpushed-'))
  await git(['init', '-q', '--bare', '-b', 'main', join(root, 'origin.git')], { cwd: root })
  work = await repo.initRepo(join(root, 'work'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false']
  ])
    await git(['config', k, v], { cwd: work })
  await commitFile('a.txt', 'base')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('unpushed commits', () => {
  it('lists the commits of the branch that are not on its upstream', async () => {
    await git(['remote', 'add', 'origin', join(root, 'origin.git')], { cwd: work })
    await git(['push', '-q', '-u', 'origin', 'main'], { cwd: work })
    const one = await commitFile('b.txt', 'one')
    const two = await commitFile('c.txt', 'two')
    expect((await repo.getState(work)).unpushed).toEqual([two, one])
    await git(['push', '-q'], { cwd: work })
    expect((await repo.getState(work)).unpushed).toEqual([])
  })

  it('for a branch without upstream, lists the commits that are on no remote', async () => {
    await git(['remote', 'add', 'origin', join(root, 'origin.git')], { cwd: work })
    await git(['push', '-q', 'origin', 'main'], { cwd: work })
    await repo.createBranch(work, 'topic', null, true)
    const mine = await commitFile('t.txt', 'topic work')
    expect((await repo.getState(work)).unpushed).toEqual([mine])
  })

  it('falls back to "on no remote" when the upstream branch was deleted', async () => {
    await git(['remote', 'add', 'origin', join(root, 'origin.git')], { cwd: work })
    await git(['push', '-q', 'origin', 'main'], { cwd: work })
    await repo.createBranch(work, 'topic', null, true)
    const first = await commitFile('t1.txt', 'pushed once')
    await git(['push', '-q', '-u', 'origin', 'topic'], { cwd: work })
    const second = await commitFile('t2.txt', 'local only')
    await git(['push', '-q', 'origin', '--delete', 'topic'], { cwd: work })
    await git(['fetch', '-q', '--prune'], { cwd: work })
    expect((await repo.getState(work)).unpushed).toEqual([second, first])
  })

  it('does not count commits already on a remote when the upstream is a local branch', async () => {
    await git(['remote', 'add', 'origin', join(root, 'origin.git')], { cwd: work })
    await git(['push', '-q', 'origin', 'main'], { cwd: work })
    await git(['checkout', '-q', '-b', 'topic', '--track', 'main'], { cwd: work })
    await commitFile('t1.txt', 'on the remote')
    await git(['push', '-q', 'origin', 'topic'], { cwd: work })
    const local = await commitFile('t2.txt', 'local only')
    expect((await repo.getState(work)).unpushed).toEqual([local])
  })

  it('is empty without remotes', async () => {
    await commitFile('b.txt', 'one')
    expect((await repo.getState(work)).unpushed).toEqual([])
  })
})
