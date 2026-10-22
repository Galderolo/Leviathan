import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { allIgnored, unwatchRepo, watchRepo } from '../src/main/watcher'
import type { RepoChangedEvent } from '../src/shared/types'

let root: string
let work: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-watch-'))
  work = await repo.initRepo(join(root, 'work'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false']
  ])
    await git(['config', k, v], { cwd: work })
  writeFileSync(join(work, '.gitignore'), '/[Ll]ibrary/\n/[Tt]emp/\n*.log\n')
  mkdirSync(join(work, 'Library'))
  mkdirSync(join(work, 'Temp'))
  mkdirSync(join(work, 'Assets'))
  writeFileSync(join(work, 'Assets', 'a.cs'), 'a\n')
  // A tracked file inside an ignored folder still matters.
  writeFileSync(join(work, 'Library', 'kept.txt'), 'kept\n')
  await git(['add', '-f', '.gitignore', 'Assets/a.cs', 'Library/kept.txt'], { cwd: work })
  await git(['commit', '-q', '-m', 'base'], { cwd: work })
})

afterEach(() => {
  unwatchRepo(work)
  rmSync(root, { recursive: true, force: true })
})

describe('allIgnored', () => {
  it('tells when every changed path is ignored by git', async () => {
    expect(await allIgnored(work, ['Temp/ShaderCache/x.bin', 'Temp', 'build.log'])).toBe(true)
    // A folder holding tracked files is not ignored as a whole.
    expect(await allIgnored(work, ['Library'])).toBe(false)
    expect(await allIgnored(work, ['Library/ShaderCache/x.bin', 'Assets/a.cs'])).toBe(false)
    expect(await allIgnored(work, ['Library/kept.txt'])).toBe(false)
    expect(await allIgnored(work, [])).toBe(false)
  })

  it('checks thousands of paths at once (an editor rebuilding its cache)', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => `Temp/Cache/Folder${i % 50}/file${i}.bin`)
    expect(await allIgnored(work, many)).toBe(true)
    expect(await allIgnored(work, [...many, 'Assets/a.cs'])).toBe(false)
  })
})

describe('watchRepo', () => {
  const events: RepoChangedEvent[] = []
  const waitFor = async (check: () => boolean, ms: number) => {
    const end = Date.now() + ms
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
    return check()
  }

  it('ignores churn in ignored folders and reports real changes', async () => {
    // A fresh repository: Windows reports the first reads of `.git` as changes. Read it once before watching.
    await repo.getState(work)
    await allIgnored(work, ['Temp/x'])
    await new Promise((r) => setTimeout(r, 300))
    events.length = 0
    watchRepo(work, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 300))
    for (let i = 0; i < 5; i++) writeFileSync(join(work, 'Temp', `cache${i}.bin`), String(i))
    writeFileSync(join(work, 'editor.log'), 'x')
    expect(await waitFor(() => events.length > 0, 2000)).toBe(false)

    writeFileSync(join(work, 'Assets', 'a.cs'), 'changed\n')
    expect(await waitFor(() => events.length > 0, 5000)).toBe(true)
    expect(events[0]).toEqual({ repo: work, kind: 'workdir' })
  })

  it('waits while git holds the index (a pull or checkout writing files) and refreshes once it is done', async () => {
    await repo.getState(work)
    await allIgnored(work, ['Temp/x'])
    await new Promise((r) => setTimeout(r, 300))
    events.length = 0
    watchRepo(work, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 300))
    const lock = join(work, '.git', 'index.lock')
    writeFileSync(lock, '')
    writeFileSync(join(work, 'Assets', 'a.cs'), 'half way through a checkout\n')
    // Longer than the 2 s maximum wait.
    expect(await waitFor(() => events.length > 0, 2600)).toBe(false)
    unlinkSync(lock)
    expect(await waitFor(() => events.length > 0, 3000)).toBe(true)
  })

  it('stays quiet through a long burst of thousands of ignored files', async () => {
    await repo.getState(work)
    await allIgnored(work, ['Temp/x'])
    await new Promise((r) => setTimeout(r, 300))
    events.length = 0
    watchRepo(work, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 300))
    // Longer than the 2 s maximum wait, with more paths than the OS change buffer holds (Windows then reports
    // "something changed" without a path).
    const start = Date.now()
    for (let round = 0; Date.now() - start < 4000; round++) {
      mkdirSync(join(work, 'Temp', `Import${round}`))
      for (let i = 0; i < 400; i++) writeFileSync(join(work, 'Temp', `Import${round}`, `asset${i}.bin`), String(i))
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(events).toHaveLength(0)
    // Afterwards at most one refresh, for the changes whose paths the OS dropped.
    await new Promise((r) => setTimeout(r, 1500))
    expect(events.length).toBeLessThanOrEqual(1)
  })
})
