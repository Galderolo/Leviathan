import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string
const subjects = async () =>
  (await git(['log', '--format=%s', '-n', '10'], { cwd: dir })).stdout.trim().split('\n').filter(Boolean)

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
  await commitFile('a.txt', 'base\n', 'base')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('several commits at once', () => {
  it('cherry-picks them in the order given', async () => {
    await repo.createBranch(dir, 'feature', null, true)
    const one = await commitFile('b.txt', 'one\n', 'one')
    const two = await commitFile('b.txt', 'two\n', 'two')
    await repo.checkout(dir, 'main')

    expect(await repo.cherryPick(dir, [one, two])).toBeNull()
    expect(await subjects()).toEqual(['two', 'one', 'base'])
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('two\n')
  })

  it('reverts them, newest first', async () => {
    const one = await commitFile('b.txt', 'one\n', 'one')
    const two = await commitFile('b.txt', 'two\n', 'two')

    expect(await repo.revert(dir, [two, one])).toBeNull()
    expect(await subjects()).toEqual(['Revert "one"', 'Revert "two"', 'two', 'one', 'base'])
  })

  it('refuses a name that could be an option', async () => {
    await expect(repo.cherryPick(dir, ['--abort'])).rejects.toThrow()
  })
})
