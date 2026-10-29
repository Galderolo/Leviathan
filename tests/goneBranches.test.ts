import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string

const commit = (message: string) => git(['commit', '-q', '--allow-empty', '-m', message], { cwd: dir })

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-test-')), 'repo'), 'main')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
  await commit('base')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('commitsOnlyOn', () => {
  it('counts the commits of each branch that no other branch, remote branch or tag has', async () => {
    await repo.createBranch(dir, 'merged', null, false)
    await repo.createBranch(dir, 'own', null, true)
    await commit('mine')
    await commit('mine too')
    await repo.createBranch(dir, 'tagged', null, true)
    await commit('tagged')
    await git(['tag', 'v1'], { cwd: dir })
    await repo.createBranch(dir, 'pushed', 'main', true)
    await commit('pushed')
    await git(['update-ref', 'refs/remotes/origin/pushed', 'HEAD'], { cwd: dir })
    await repo.checkout(dir, 'main')

    expect(await repo.commitsOnlyOn(dir, ['merged', 'own', 'tagged', 'pushed'])).toEqual({
      merged: 0,
      // Its two commits are also on `tagged`, which is not being looked at: still on another branch.
      own: 0,
      tagged: 0,
      pushed: 0
    })
    await repo.deleteBranch(dir, 'tagged', true)
    await git(['tag', '-d', 'v1'], { cwd: dir })
    expect(await repo.commitsOnlyOn(dir, ['own'])).toEqual({ own: 2 })
  })

  it('refuses a name that is not a branch name', async () => {
    await expect(repo.commitsOnlyOn(dir, ['--all'])).rejects.toThrow()
  })
})
