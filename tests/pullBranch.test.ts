import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let root: string
let work: string
let other: string
const noProgress = () => {}

async function configure(dir: string) {
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
}

async function commitFile(dir: string, name: string, content: string, message: string) {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
}

const tip = async (dir: string, ref: string) => (await git(['rev-parse', ref], { cwd: dir })).stdout.trim()

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-pullbranch-'))
  await git(['init', '-q', '--bare', '-b', 'main', join(root, 'origin.git')], { cwd: root })
  work = await repo.initRepo(join(root, 'work'), 'main')
  await configure(work)
  await commitFile(work, 'a.txt', 'a\n', 'base')
  await git(['remote', 'add', 'origin', join(root, 'origin.git')], { cwd: work })
  await git(['push', '-q', '-u', 'origin', 'main'], { cwd: work })
  await git(['push', '-q', '-u', 'origin', 'main:develop'], { cwd: work })
  await git(['branch', '-q', '--track', 'develop', 'origin/develop'], { cwd: work })

  // Someone else adds commits to develop.
  other = join(root, 'other')
  await git(['clone', '-q', '-b', 'develop', join(root, 'origin.git'), other], { cwd: root })
  await configure(other)
  await commitFile(other, 'd.txt', '1\n', 'remote 1')
  await commitFile(other, 'd.txt', '2\n', 'remote 2')
  await git(['push', '-q', 'origin', 'develop'], { cwd: other })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('pullBranch', () => {
  it('fast-forwards a branch that is not checked out, without switching', async () => {
    await repo.pullBranch(work, 'develop', noProgress)
    expect(await tip(work, 'develop')).toBe(await tip(other, 'HEAD'))
    expect(await tip(work, 'origin/develop')).toBe(await tip(other, 'HEAD'))
    expect((await repo.getState(work)).head.branch).toBe('main')
  })

  it('refuses when the branch has its own commits, leaving it as it was', async () => {
    await repo.checkout(work, 'develop')
    await commitFile(work, 'local.txt', 'mine\n', 'local work')
    const mine = await tip(work, 'develop')
    await repo.checkout(work, 'main')
    await expect(repo.pullBranch(work, 'develop', noProgress)).rejects.toThrow(/check it out/)
    expect(await tip(work, 'develop')).toBe(mine)
  })

  it('refuses a branch without an upstream', async () => {
    await repo.createBranch(work, 'solo', null, false)
    await expect(repo.pullBranch(work, 'solo', noProgress)).rejects.toThrow(/upstream/)
  })
})
