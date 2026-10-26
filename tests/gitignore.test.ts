import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { ignoreExtension, ignoreFile } from '../src/shared/gitignore'

describe('gitignore patterns', () => {
  it('ignore one file by its name taken literally, from the top of the repository', () => {
    expect(ignoreFile('build/out.log')).toBe('/build/out.log')
    expect(ignoreFile('pages/[id].tsx')).toBe('/pages/\\[id].tsx')
    expect(ignoreFile('a*b?.txt')).toBe('/a\\*b\\?.txt')
    expect(ignoreFile('back\\slash')).toBe('/back\\\\slash')
    // git drops trailing spaces unless they are escaped.
    expect(ignoreFile('notes  ')).toBe('/notes\\ \\ ')
  })

  it('ignore every file with an extension, taken literally', () => {
    expect(ignoreExtension('log')).toBe('*.log')
    expect(ignoreExtension('b[ak]')).toBe('*.b\\[ak]')
  })
})

describe('ignoring a file', () => {
  let dir: string
  beforeEach(async () => {
    dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-ignore-')), 'repo'), 'main')
  })
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

  const ignored = async (file: string) =>
    (await git(['check-ignore', '-q', '--', file], { cwd: dir, okCodes: [0, 1] })).exitCode === 0

  it('ignores the file named, not others its name would match as a pattern', async () => {
    for (const name of ['[id].tsx', 'i.tsx', 'd.tsx']) writeFileSync(join(dir, name), 'x\n')
    await repo.ignore(dir, ignoreFile('[id].tsx'))
    expect(await ignored('[id].tsx')).toBe(true)
    expect(await ignored('i.tsx')).toBe(false)
    expect(await ignored('d.tsx')).toBe(false)
  })

  // Windows allows no * in file names.
  it.skipIf(process.platform === 'win32')('takes a star in a name literally', async () => {
    for (const name of ['a*b.txt', 'aXb.txt']) writeFileSync(join(dir, name), 'x\n')
    await repo.ignore(dir, ignoreFile('a*b.txt'))
    expect(await ignored('a*b.txt')).toBe(true)
    expect(await ignored('aXb.txt')).toBe(false)
  })
})
