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
