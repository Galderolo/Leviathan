import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { viewAfterCheckout } from '../src/renderer/src/checkoutView'

let dir: string

async function commitFile(name: string, content: string, message: string): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-test-')), 'repo'), 'main')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
  await commitFile('readme.txt', 'base\n', 'base')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

describe('viewAfterCheckout', () => {
  it('shows the uncommitted changes that came along to the other branch', async () => {
    await repo.createBranch(dir, 'test-2', null, false)
    writeFileSync(join(dir, 'test.txt'), 'new\n')
    await repo.checkout(dir, 'test-2')

    expect(viewAfterCheckout(await repo.getState(dir))).toEqual({ kind: 'wip' })
  })

  it("shows the branch's last commit when there is nothing uncommitted", async () => {
    await repo.createBranch(dir, 'test-2', null, true)
    const tip = await commitFile('other.txt', 'other\n', 'on test-2')
    await repo.checkout(dir, 'main')
    await repo.checkout(dir, 'test-2')

    expect(viewAfterCheckout(await repo.getState(dir))).toEqual({ kind: 'commit', hash: tip })
  })

  it('has nothing to show without a state', () => {
    expect(viewAfterCheckout(null)).toBeNull()
  })
})
