import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { parseCommitTemplate } from '../src/shared/commitTemplate'

describe('parseCommitTemplate', () => {
  it('puts the first line in the summary and the rest in the description, without comments', () => {
    expect(parseCommitTemplate('feat: \n\n# Say why, not what.\nWhy:\n\nRefs: #\n\n')).toEqual({
      summary: 'feat: ',
      body: 'Why:\n\nRefs: #'
    })
  })

  it('leaves the summary empty when the template starts with an empty line', () => {
    expect(parseCommitTemplate('\n# The summary goes above.\nTicket: \n')).toEqual({ summary: '', body: 'Ticket:' })
  })

  it('is nothing for a template of comments only, and keeps Windows line endings out', () => {
    expect(parseCommitTemplate('# Only advice here\n#\n')).toBeNull()
    expect(parseCommitTemplate('fix: \r\n\r\nWhy:\r\n')).toEqual({ summary: 'fix: ', body: 'Why:' })
  })
})

describe('getCommitTemplate', () => {
  let dir: string
  beforeEach(async () => {
    dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-template-')), 'repo'), 'main')
  })
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

  it("reads the template git's commit.template points to, from the repository's folder", async () => {
    writeFileSync(join(dir, '.gitmessage'), 'feat: \n\n# why?\nWhy:\n')
    await git(['config', 'commit.template', '.gitmessage'], { cwd: dir })
    expect(await repo.getCommitTemplate(dir)).toEqual({ summary: 'feat: ', body: 'Why:' })
  })

  it('is nothing without a template, or when its file is missing', async () => {
    // The machine's global config could set one: this repository sets an empty one of its own.
    await git(['config', 'commit.template', ''], { cwd: dir })
    expect(await repo.getCommitTemplate(dir)).toBeNull()
    await git(['config', 'commit.template', 'no-such-file'], { cwd: dir })
    expect(await repo.getCommitTemplate(dir)).toBeNull()
  })
})
