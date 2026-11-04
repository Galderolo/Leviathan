import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string

async function commitFiles(files: Record<string, string>, message: string): Promise<string> {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  await repo.stage(dir, Object.keys(files))
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
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('searching in what commits change', () => {
  it('finds the commits that add or remove the text, whatever its case, newest first', async () => {
    const added = await commitFiles({ 'a.txt': 'let speed = 10\n' }, 'add speed')
    await commitFiles({ 'b.txt': 'unrelated\n' }, 'mentions speed only in its message')
    // Moved within the file: as many as before, so it neither adds nor removes it.
    await commitFiles({ 'a.txt': '\nlet speed = 10\n' }, 'move it')
    const removed = await commitFiles({ 'a.txt': 'let velocity = 10\n' }, 'rename it')

    expect(await repo.searchChanges(dir, 'SPEED')).toEqual({ hashes: [removed, added], more: false })
    expect(await repo.searchChanges(dir, 'nowhere')).toEqual({ hashes: [], more: false })
    // A text that would read as an option is only text.
    expect(await repo.searchChanges(dir, '--all')).toEqual({ hashes: [], more: false })
  })

  it('looks only where the graph does: one branch alone, or all but those hidden', async () => {
    await commitFiles({ 'a.txt': 'base\n' }, 'base')
    await git(['checkout', '-q', '-b', 'feature'], { cwd: dir })
    const onFeature = await commitFiles({ 'f.txt': 'needle\n' }, 'feature work')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    const onMain = await commitFiles({ 'm.txt': 'needle\n' }, 'main work')

    expect((await repo.searchChanges(dir, 'needle')).hashes.sort()).toEqual([onFeature, onMain].sort())
    expect(await repo.searchChanges(dir, 'needle', { solo: 'refs/heads/feature' })).toEqual({
      hashes: [onFeature],
      more: false
    })
    expect(await repo.searchChanges(dir, 'needle', { hidden: ['refs/heads/feature'] })).toEqual({
      hashes: [onMain],
      more: false
    })
  })

  it('finds nothing in a repository without commits, and refuses a text of several lines', async () => {
    expect(await repo.searchChanges(dir, 'x')).toEqual({ hashes: [], more: false })
    await expect(repo.searchChanges(dir, 'a\nb')).rejects.toThrow()
    await expect(repo.searchChanges(dir, '')).rejects.toThrow()
  })

  it('stops when asked', async () => {
    await commitFiles({ 'a.txt': 'one\n' }, 'one')
    const control = new AbortController()
    control.abort()
    await expect(repo.searchChanges(dir, 'one', {}, control.signal)).rejects.toThrow()
  })
})
