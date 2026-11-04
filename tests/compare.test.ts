import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { difftoolArgs } from '../src/shared/externalTools'

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

describe('comparing two commits, or a commit with the working tree', () => {
  it('lists the files that differ between two commits, however far apart', async () => {
    const first = await commitFiles({ 'a.txt': 'one\n', 'b.txt': 'b\n' }, 'first')
    await commitFiles({ 'a.txt': 'two\n' }, 'second')
    await git(['rm', '-q', 'b.txt'], { cwd: dir })
    const third = await commitFiles({ 'c.txt': 'c\n' }, 'third')

    expect(await repo.compareFiles(dir, first, third)).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'D' },
      { path: 'c.txt', status: 'A' }
    ])
    const diff = await repo.getDiff(dir, { kind: 'commit', hash: third, parent: first, path: 'a.txt' })
    expect(diff.hunks[0].lines.map((l) => `${l.type}:${l.text}`)).toEqual(['del:one', 'add:two'])
  })

  it('compares a commit with the files as they are, staged or not', async () => {
    const first = await commitFiles({ 'a.txt': 'one\n', 'b.txt': 'b\n' }, 'first')
    await commitFiles({ 'a.txt': 'two\n' }, 'second')
    writeFileSync(join(dir, 'a.txt'), 'three\n')
    writeFileSync(join(dir, 'b.txt'), 'staged\n')
    await repo.stage(dir, ['b.txt'])

    expect(await repo.compareFiles(dir, first, null)).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' }
    ])
    const diff = await repo.getDiff(dir, { kind: 'tree', base: first, path: 'a.txt' })
    expect(diff.hunks[0].lines.map((l) => `${l.type}:${l.text}`)).toEqual(['del:one', 'add:three'])
  })

  it('lists the new files not tracked yet when compared with the working tree, and shows them', async () => {
    const first = await commitFiles({ 'a.txt': 'one\n' }, 'first')
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')
    writeFileSync(join(dir, 'a.txt'), 'two\n')

    expect(await repo.compareFiles(dir, first, null)).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'new.txt', status: '?' }
    ])
    const diff = await repo.getDiff(dir, { kind: 'tree', base: first, path: 'new.txt', untracked: true })
    expect(diff.hunks[0].lines.map((l) => `${l.type}:${l.text}`)).toEqual(['add:brand new'])
    // Between two commits, nothing untracked comes in.
    const second = await commitFiles({ 'a.txt': 'two\n' }, 'second')
    expect(await repo.compareFiles(dir, first, second)).toEqual([{ path: 'a.txt', status: 'M' }])
  })

  it('shows an image compared with the working tree as the commit has it and as it is now', async () => {
    const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n])
    writeFileSync(join(dir, 'shot.png'), png(1))
    await repo.stage(dir, ['shot.png'])
    await repo.commit(dir, 'picture', false)
    const first = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    writeFileSync(join(dir, 'shot.png'), png(2))

    const { before, after } = await repo.getImages(dir, { kind: 'tree', base: first, path: 'shot.png' })
    expect(before?.url).toBe(`data:image/png;base64,${png(1).toString('base64')}`)
    expect(after?.url).toBe(`data:image/png;base64,${png(2).toString('base64')}`)
  })

  it('opens the external diff tool on a commit against the working tree', () => {
    expect(difftoolArgs({ kind: 'tree', base: 'abc123', path: 'a.txt' }, null)).toEqual([
      'difftool',
      '-y',
      'abc123',
      '--',
      'a.txt'
    ])
  })

  it('refuses something that is not a commit', async () => {
    await expect(repo.compareFiles(dir, '--all', null)).rejects.toThrow()
  })
})
