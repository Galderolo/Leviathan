import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string

async function commitFile(name: string, message: string) {
  writeFileSync(join(dir, name), `${name}\n`)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
}

const subjects = async (scope?: { hidden?: string[]; solo?: string | null }) =>
  (await repo.getLog(dir, 100, scope)).commits.map((c) => c.subject)

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-scope-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
  await commitFile('a.txt', 'base')
  await repo.createBranch(dir, 'feature/login', null, true)
  await commitFile('l.txt', 'login work')
  await repo.checkout(dir, 'main')
  await repo.createBranch(dir, 'experiment', null, true)
  await commitFile('e.txt', 'experiment work')
  await repo.checkout(dir, 'main')
  await commitFile('m.txt', 'main work')
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('getLog scope', () => {
  it('shows every branch by default', async () => {
    expect((await subjects()).sort()).toEqual(['base', 'experiment work', 'login work', 'main work'])
  })

  it('hides the commits only a hidden branch has, nested names included', async () => {
    const shown = await subjects({ hidden: ['refs/heads/feature/login', 'refs/heads/experiment'] })
    expect(shown.sort()).toEqual(['base', 'main work'])
  })

  it('does not bring a hidden checked-out branch back through HEAD', async () => {
    await repo.checkout(dir, 'experiment')
    const shown = await subjects({ hidden: ['refs/heads/experiment'] })
    expect(shown).not.toContain('experiment work')
  })

  it('shows only one branch when asked', async () => {
    expect((await subjects({ solo: 'refs/heads/feature/login' })).sort()).toEqual(['base', 'login work'])
  })

  it('falls back to everything when the branch to show alone is gone, and ignores odd entries', async () => {
    expect((await subjects({ solo: 'refs/heads/deleted' })).length).toBe(4)
    expect((await subjects({ hidden: ['--all', 'HEAD'] })).length).toBe(4)
  })
})
