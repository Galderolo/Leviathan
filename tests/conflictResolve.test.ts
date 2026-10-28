import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'

let dir: string

async function commitFile(name: string, content: string, message: string) {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
}

/** main and `other` both edit a.txt, then main merges other. */
async function conflictOnA() {
  await commitFile('a.txt', 'base\n', 'base')
  await repo.createBranch(dir, 'other', null, true)
  await commitFile('a.txt', 'theirs\n', 'other edits')
  await repo.checkout(dir, 'main')
  await commitFile('a.txt', 'ours\n', 'main edits')
  await repo.merge(dir, 'other').catch(() => {})
}

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-conflict-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('conflict resolution', () => {
  it('reads the conflicted file with its markers', async () => {
    await conflictOnA()
    const file = await repo.readWorkingFile(dir, 'a.txt')
    expect(file.reason).toBeNull()
    expect(file.text).toContain('<<<<<<<')
  })

  it('writes a resolution and marks the file resolved', async () => {
    await conflictOnA()
    const { text } = await repo.readWorkingFile(dir, 'a.txt')
    await repo.resolveConflictFile(dir, 'a.txt', 'merged\n', text!)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('merged\n')
    const { status } = await repo.getState(dir)
    expect(status.conflicted).toEqual([])
    expect(status.staged.map((f) => f.path)).toContain('a.txt')
  })

  it('takes one side of the whole file', async () => {
    await conflictOnA()
    await repo.resolveConflictWith(dir, 'a.txt', 'ours')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('ours\n')
    expect((await repo.getState(dir)).status.conflicted).toEqual([])
  })

  it('takes the deletion when the incoming side deleted the file', async () => {
    await commitFile('a.txt', 'base\n', 'base')
    await repo.createBranch(dir, 'other', null, true)
    await git(['rm', '-q', 'a.txt'], { cwd: dir })
    await repo.commit(dir, 'delete a', false)
    await repo.checkout(dir, 'main')
    await commitFile('a.txt', 'changed here\n', 'edit a')
    await repo.merge(dir, 'other').catch(() => {})
    expect((await repo.getState(dir)).status.conflicted.map((f) => f.path)).toEqual(['a.txt'])

    await repo.resolveConflictWith(dir, 'a.txt', 'theirs')
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
    const { status } = await repo.getState(dir)
    expect(status.conflicted).toEqual([])
    expect(status.staged).toEqual([{ path: 'a.txt', status: 'D' }])
  })
})

describe('edits to a conflicted file', () => {
  it('sees a file as git left it, and one edited since', async () => {
    await conflictOnA()
    expect(await repo.conflictFileEdited(dir, 'a.txt')).toBe(false)
    writeFileSync(join(dir, 'a.txt'), readFileSync(join(dir, 'a.txt'), 'utf8') + 'a line of mine\n')
    expect(await repo.conflictFileEdited(dir, 'a.txt')).toBe(true)
  })

  it('sees a block resolved by hand as an edit', async () => {
    await conflictOnA()
    writeFileSync(join(dir, 'a.txt'), 'ours\n')
    expect(await repo.conflictFileEdited(dir, 'a.txt')).toBe(true)
  })

  it('reads a file left with Windows line endings, or with the base in the markers, as untouched', async () => {
    await git(['config', 'core.autocrlf', 'true'], { cwd: dir })
    await git(['config', 'merge.conflictStyle', 'diff3'], { cwd: dir })
    await conflictOnA()
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toMatch(/\|{7}/)
    expect(await repo.conflictFileEdited(dir, 'a.txt')).toBe(false)
  })

  it('compares with the side that kept the file when the other deleted it', async () => {
    await commitFile('a.txt', 'base\n', 'base')
    await repo.createBranch(dir, 'other', null, true)
    await git(['rm', '-q', 'a.txt'], { cwd: dir })
    await repo.commit(dir, 'delete a', false)
    await repo.checkout(dir, 'main')
    await commitFile('a.txt', 'changed here\n', 'edit a')
    await repo.merge(dir, 'other').catch(() => {})
    expect(await repo.conflictFileEdited(dir, 'a.txt')).toBe(false)
    writeFileSync(join(dir, 'a.txt'), 'changed again\n')
    expect(await repo.conflictFileEdited(dir, 'a.txt')).toBe(true)
  })

  it('sees a file both sides added, and a binary file, as untouched', async () => {
    await commitFile('readme.txt', 'base\n', 'base')
    await repo.createBranch(dir, 'other', null, true)
    await commitFile('new.txt', 'theirs\n', 'add there')
    await commitFile('pic.bin', Buffer.from([0, 1, 2, 3, 0, 9]).toString('latin1'), 'binary there')
    await repo.checkout(dir, 'main')
    await commitFile('new.txt', 'ours\n', 'add here')
    await commitFile('pic.bin', Buffer.from([0, 7, 7, 7, 0, 9]).toString('latin1'), 'binary here')
    await repo.merge(dir, 'other').catch(() => {})
    expect((await repo.getState(dir)).status.conflicted.map((f) => f.path).sort()).toEqual(['new.txt', 'pic.bin'])
    expect(await repo.conflictFileEdited(dir, 'new.txt')).toBe(false)
    expect(await repo.conflictFileEdited(dir, 'pic.bin')).toBe(false)
  })
})

describe('a file both sides deleted', () => {
  it('reads as missing rather than failing, and resolves by keeping it deleted', async () => {
    await commitFile('gone.txt', 'base\n', 'base')
    const blob = (await git(['rev-parse', ':gone.txt'], { cwd: dir })).stdout.trim()
    // Only the base is left in the index, and nothing in the working tree: git's "deleted by both".
    await git(['rm', '-q', 'gone.txt'], { cwd: dir })
    await git(['update-index', '--index-info'], { cwd: dir, input: `100644 ${blob} 1\tgone.txt\n` })
    expect((await repo.getState(dir)).status.conflicted.map((f) => f.path)).toEqual(['gone.txt'])

    expect(await repo.readWorkingFile(dir, 'gone.txt')).toEqual({ text: null, reason: 'missing' })
    await repo.resolveConflictWith(dir, 'gone.txt', 'ours')
    expect((await repo.getState(dir)).status.conflicted).toEqual([])
  })
})

describe('conflict resolution safety', () => {
  it('refuses to edit a file too large to read whole', async () => {
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(3 * 1024 * 1024))
    expect(await repo.readWorkingFile(dir, 'big.txt')).toEqual({ text: null, reason: 'large' })
  })

  it('refuses to edit a file that is not UTF-8', async () => {
    writeFileSync(join(dir, 'latin1.txt'), Buffer.from('caf\xe9\n', 'latin1'))
    expect(await repo.readWorkingFile(dir, 'latin1.txt')).toEqual({ text: null, reason: 'encoding' })
  })

  it('keeps a byte order mark', async () => {
    writeFileSync(join(dir, 'bom.txt'), '﻿hello\n')
    expect((await repo.readWorkingFile(dir, 'bom.txt')).text).toBe('﻿hello\n')
  })

  it('does not save over a file that changed since it was read', async () => {
    await conflictOnA()
    const { text } = await repo.readWorkingFile(dir, 'a.txt')
    writeFileSync(join(dir, 'a.txt'), 'edited elsewhere\n')
    await expect(repo.resolveConflictFile(dir, 'a.txt', 'merged\n', text!)).rejects.toThrow(/changed/)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('edited elsewhere\n')
  })

  it('does not touch a file that is no longer in conflict', async () => {
    await conflictOnA()
    await repo.resolveConflictWith(dir, 'a.txt', 'ours')
    await expect(repo.resolveConflictWith(dir, 'a.txt', 'ours')).rejects.toThrow(/no longer in conflict/)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('ours\n')
    // "ours" is HEAD's version, so nothing is left staged (and certainly no deletion).
    expect((await repo.getState(dir)).status.staged).toEqual([])
  })

  it('stages the incoming commit of a conflicted submodule', async () => {
    await commitFile('a.txt', 'base\n', 'base')
    const [base, ours, theirs] = ['1', '2', '3'].map((c) => c.repeat(40))
    await git(['update-index', '--index-info'], {
      cwd: dir,
      input: `160000 ${base} 1\tsub\n160000 ${ours} 2\tsub\n160000 ${theirs} 3\tsub\n`
    })
    await repo.resolveConflictWith(dir, 'sub', 'theirs')
    expect((await git(['ls-files', '-s', 'sub'], { cwd: dir })).stdout.trim()).toBe(`160000 ${theirs} 0\tsub`)
  })
})
