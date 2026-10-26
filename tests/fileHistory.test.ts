import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string
const hashes: Record<string, string> = {}

async function commitAs(author: string, message: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  await repo.stage(dir, Object.keys(files))
  await git(
    [
      '-c',
      `user.name=${author}`,
      '-c',
      `user.email=${author.toLowerCase()}@example.com`,
      'commit',
      '-q',
      '-m',
      message
    ],
    {
      cwd: dir
    }
  )
  hashes[message] = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-history-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
  await commitAs('Ana', 'add notes', { 'notes.txt': 'one\ntwo\n' })
  await commitAs('Bo', 'other file', { 'other.txt': 'x\n' })
  await commitAs('Bo', 'edit notes', { 'notes.txt': 'one\ntwo, edited\n' })
  await git(['mv', 'notes.txt', 'docs.txt'], { cwd: dir })
  await git(['commit', '-q', '-m', 'rename notes'], { cwd: dir })
  hashes['rename notes'] = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

describe('getFileHistory', () => {
  it('lists the commits that touched the file, newest first, following a rename', async () => {
    const history = await repo.getFileHistory(dir, 'docs.txt')
    expect(history.map((h) => h.commit.subject)).toEqual(['rename notes', 'edit notes', 'add notes'])
    expect(history[0]).toMatchObject({ path: 'docs.txt', oldPath: 'notes.txt', status: 'R' })
    expect(history[1]).toMatchObject({ path: 'notes.txt', status: 'M' })
    expect(history[2]).toMatchObject({ path: 'notes.txt', status: 'A' })
    expect(history[1].commit.authorName).toBe('Bo')
    expect(history[1].commit.hash).toBe(hashes['edit notes'])
  })

  it('refuses paths outside the repository', async () => {
    await expect(repo.getFileHistory(dir, '../escape.txt')).rejects.toThrow(/outside/)
  })
})

describe('getBlame', () => {
  it('says who wrote each line, with uncommitted lines on their own', async () => {
    writeFileSync(join(dir, 'docs.txt'), 'one\ntwo, edited\nthree, not committed\n')
    const lines = await repo.getBlame(dir, 'docs.txt', null)
    expect(lines.map((l) => [l.line, l.text, l.author])).toEqual([
      [1, 'one', 'Ana'],
      [2, 'two, edited', 'Bo'],
      [3, 'three, not committed', 'Not Committed Yet']
    ])
    expect(lines[0].hash).toBe(hashes['add notes'])
    expect(lines[0].summary).toBe('add notes')
    expect(lines[2].hash).toMatch(/^0+$/)
  })

  it('blames the file as it was in a given commit', async () => {
    const lines = await repo.getBlame(dir, 'notes.txt', hashes['add notes'])
    expect(lines.map((l) => [l.text, l.author])).toEqual([
      ['one', 'Ana'],
      ['two', 'Ana']
    ])
  })

  it('refuses paths outside the repository and odd revisions', async () => {
    await expect(repo.getBlame(dir, '../escape.txt', null)).rejects.toThrow(/outside/)
    await expect(repo.getBlame(dir, 'docs.txt', '--output=x')).rejects.toThrow()
  })
})

describe('history and blame edge cases', () => {
  it('starts the history from a given commit, for files of another branch', async () => {
    await repo.createBranch(dir, 'feature', null, true)
    await commitAs('Cy', 'feature only', { 'feat.txt': 'f\n' })
    const tip = hashes['feature only']
    await repo.checkout(dir, 'main')
    expect(await repo.getFileHistory(dir, 'feat.txt', null)).toEqual([])
    expect((await repo.getFileHistory(dir, 'feat.txt', tip)).map((h) => h.commit.subject)).toEqual(['feature only'])
    await expect(repo.getFileHistory(dir, 'feat.txt', '--all')).rejects.toThrow()
  })

  it('refuses to blame a binary file before running blame', async () => {
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 2, 0, 3, 4]))
    await expect(repo.getBlame(dir, 'blob.bin', null)).rejects.toThrow(/binary/i)
    await repo.stage(dir, ['blob.bin'])
    await repo.commit(dir, 'add blob', false)
    const head = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    await expect(repo.getBlame(dir, 'blob.bin', head)).rejects.toThrow(/binary/i)
  })
})

describe('getFolderHistory', () => {
  beforeEach(async () => {
    for (const folder of ['Assets/UI', 'AssetsOld', 'Art[1]', 'Art1']) mkdirSync(join(dir, folder), { recursive: true })
    await commitAs('Ana', 'add menu', { 'Assets/UI/Menu.cs': 'a\n' })
    await commitAs('Bo', 'touch root', { 'other.txt': 'y\n' })
    await commitAs('Bo', 'add hud', { 'Assets/Hud.cs': 'b\n' })
    // A folder whose name starts the same is another folder.
    await commitAs('Cy', 'old assets', { 'AssetsOld/x.cs': 'c\n' })
    await commitAs('Cy', 'art one', { 'Art1/a.png': 'p\n' })
  })

  const subjects = async (folder: string, rev: string | null = null) =>
    (await repo.getFolderHistory(dir, folder, rev)).map((c) => c.subject)

  it('lists only the latest commits asked for, of a folder or of a file', async () => {
    expect((await repo.getFolderHistory(dir, 'Assets', null, 1)).map((c) => c.subject)).toEqual(['add hud'])
    expect((await repo.getFileHistory(dir, 'docs.txt', null, 2)).map((h) => h.commit.subject)).toEqual([
      'rename notes',
      'edit notes'
    ])
  })

  it('lists the commits that changed anything inside a folder, newest first', async () => {
    expect(await subjects('Assets')).toEqual(['add hud', 'add menu'])
    expect(await subjects('Assets/UI/')).toEqual(['add menu'])
    // From another commit, as file history does.
    expect(await subjects('Assets', hashes['add menu'])).toEqual(['add menu'])
  })

  it('takes the folder name literally: Art[1] is not a pattern matching Art1', async () => {
    expect(await subjects('Art[1]')).toEqual([])
    expect(await subjects('Art1')).toEqual(['art one'])
  })

  it('refuses the whole repository and folders outside it', async () => {
    await expect(repo.getFolderHistory(dir, '')).rejects.toThrow()
    await expect(repo.getFolderHistory(dir, '.')).rejects.toThrow()
    await expect(repo.getFolderHistory(dir, '../x')).rejects.toThrow(/outside/)
    await expect(repo.getFolderHistory(dir, 'Assets', '--all')).rejects.toThrow()
  })
})
