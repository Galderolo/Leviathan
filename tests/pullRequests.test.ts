import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let root: string
let work: string
let forkTip: string

async function configure(dir: string) {
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
}

async function commitFile(dir: string, name: string, message: string) {
  writeFileSync(join(dir, name), `${name}\n`)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-pr-'))
  const origin = join(root, 'origin.git')
  await git(['init', '-q', '--bare', '-b', 'main', origin], { cwd: root })
  work = await repo.initRepo(join(root, 'work'), 'main')
  await configure(work)
  await commitFile(work, 'a.txt', 'base')
  await git(['remote', 'add', 'origin', origin], { cwd: work })
  await git(['push', '-q', '-u', 'origin', 'main'], { cwd: work })

  // A contributor's branch in the same repository, and a fork's pull request (refs/pull/7/head).
  const other = join(root, 'other')
  await git(['clone', '-q', origin, other], { cwd: root })
  await configure(other)
  await git(['checkout', '-q', '-b', 'feature'], { cwd: other })
  await commitFile(other, 'f.txt', 'feature work')
  await git(['push', '-q', 'origin', 'feature'], { cwd: other })
  await git(['checkout', '-q', '-b', 'fork-work', 'main'], { cwd: other })
  forkTip = await commitFile(other, 'k.txt', 'fork work')
  await git(['push', '-q', 'origin', 'HEAD:refs/pull/7/head'], { cwd: other })
  await git(['push', '-q', 'origin', 'feature:refs/pull/3/head'], { cwd: other })
  otherDir = other
})

let otherDir: string
const tip = async (dir: string, ref: string) => (await git(['rev-parse', ref], { cwd: dir })).stdout.trim()

/** The contributor rewrites the fork's pull request (amend + force push). */
async function rewriteForkPr() {
  await git(['checkout', '-q', 'fork-work'], { cwd: otherDir })
  await git(['commit', '-q', '--amend', '-m', 'fork work, rewritten'], { cwd: otherDir })
  await git(['push', '-q', '-f', 'origin', 'HEAD:refs/pull/7/head'], { cwd: otherDir })
  return tip(otherDir, 'HEAD')
}

describe('checking out a pull request again', () => {
  const fork = { number: 7, sourceBranch: 'fork-work', fromFork: true }
  const same = { number: 3, sourceBranch: 'feature', fromFork: false }

  it('updates pr/N, checked out, when the fork pull request gained commits', async () => {
    await repo.checkoutPullRequest(work, 'origin', fork, 'github')
    await git(['checkout', '-q', 'fork-work'], { cwd: otherDir })
    const newer = await commitFile(otherDir, 'k2.txt', 'more fork work')
    await git(['push', '-q', 'origin', 'HEAD:refs/pull/7/head'], { cwd: otherDir })
    await repo.checkoutPullRequest(work, 'origin', fork, 'github')
    expect((await repo.getState(work)).head).toMatchObject({ branch: 'pr/7', hash: newer })
  })

  it('follows a rewritten fork pull request when pr/N has no commits of its own', async () => {
    await repo.checkoutPullRequest(work, 'origin', fork, 'github')
    const rewritten = await rewriteForkPr()
    await repo.checkoutPullRequest(work, 'origin', fork, 'github')
    expect((await repo.getState(work)).head.hash).toBe(rewritten)
  })

  it('never drops commits made on pr/N', async () => {
    await repo.checkoutPullRequest(work, 'origin', fork, 'github')
    const mine = await commitFile(work, 'mine.txt', 'my review fix')
    await rewriteForkPr()
    await expect(repo.checkoutPullRequest(work, 'origin', fork, 'github')).rejects.toThrow(/own/)
    expect(await tip(work, 'pr/7')).toBe(mine)
  })

  it('checks out a same-repository pull request after its branch was force-pushed', async () => {
    await git(['fetch', '-q', 'origin'], { cwd: work })
    await git(['checkout', '-q', 'feature'], { cwd: otherDir })
    await git(['commit', '-q', '--amend', '-m', 'feature, rewritten'], { cwd: otherDir })
    await git(['push', '-q', '-f', 'origin', 'feature'], { cwd: otherDir })
    await repo.checkoutPullRequest(work, 'origin', same, 'github')
    expect((await repo.getState(work)).head).toMatchObject({ branch: 'feature', hash: await tip(otherDir, 'HEAD') })
  })

  it('fast-forwards the local branch that tracks the pull request branch', async () => {
    await repo.checkoutPullRequest(work, 'origin', same, 'github')
    await repo.checkout(work, 'main')
    await git(['checkout', '-q', 'feature'], { cwd: otherDir })
    const newer = await commitFile(otherDir, 'f2.txt', 'more feature work')
    await git(['push', '-q', 'origin', 'feature'], { cwd: otherDir })
    await repo.checkoutPullRequest(work, 'origin', same, 'github')
    expect((await repo.getState(work)).head).toMatchObject({ branch: 'feature', hash: newer })
  })

  it('uses pr/N when a local branch with the same name is unrelated', async () => {
    await repo.createBranch(work, 'feature', null, false)
    await repo.checkoutPullRequest(work, 'origin', same, 'github')
    expect((await repo.getState(work)).head).toMatchObject({ branch: 'pr/3', hash: await tip(otherDir, 'feature') })
  })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('checkoutPullRequest', () => {
  it('checks out a pull request from a fork as pr/N', async () => {
    await repo.checkoutPullRequest(work, 'origin', { number: 7, sourceBranch: 'fork-work', fromFork: true }, 'github')
    const state = await repo.getState(work)
    expect(state.head.branch).toBe('pr/7')
    expect(state.head.hash).toBe(forkTip)
  })

  it('checks out a branch of the same repository, tracking the remote one', async () => {
    await repo.checkoutPullRequest(work, 'origin', { number: 3, sourceBranch: 'feature', fromFork: false }, 'github')
    const state = await repo.getState(work)
    expect(state.head.branch).toBe('feature')
    expect(state.refs.find((r) => r.name === 'feature' && r.type === 'head')?.upstream).toBe('origin/feature')
  })

  it('refuses odd numbers and branch names', async () => {
    const bad = { number: 1.5, sourceBranch: 'x', fromFork: true }
    await expect(repo.checkoutPullRequest(work, 'origin', bad, 'github')).rejects.toThrow()
    const dash = { number: 1, sourceBranch: '--upload-pack=x', fromFork: false }
    await expect(repo.checkoutPullRequest(work, 'origin', dash, 'github')).rejects.toThrow()
  })
})
