import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getReflog } from '../src/main/git/reflog'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { parseReflog, reflogKind } from '../src/shared/reflog'

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
    ['core.autocrlf', 'false'],
    ['core.logAllRefUpdates', 'true']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('the reflog', () => {
  it('lists where HEAD has been, newest first, and marks the commits no branch has any more', async () => {
    const first = await commitFile('a.txt', 'one\n', 'first')
    const second = await commitFile('a.txt', 'two\n', 'second')
    await repo.reset(dir, first, 'hard')
    await git(['checkout', '-q', '-b', 'side'], { cwd: dir })
    const onSide = await commitFile('b.txt', 'side\n', 'on side')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    await git(['branch', '-q', '-D', 'side'], { cwd: dir })

    const { entries, more } = await getReflog(dir)
    expect(more).toBe(false)
    expect(entries.map((e) => [e.action, e.hash, e.lost])).toEqual([
      ['checkout', first, false],
      ['commit', onSide, true],
      ['checkout', first, false],
      ['reset', first, false],
      ['commit', second, true],
      ['commit (initial)', first, false]
    ])
    expect(entries[0]).toMatchObject({ index: 0, detail: 'moving from side to main', subject: 'first' })
    expect(entries[1]).toMatchObject({ index: 1, detail: 'on side', subject: 'on side' })
    expect(entries[0].date).toBeGreaterThan(1_600_000_000)

    // A branch on a lost commit keeps it: it is not lost any more.
    await repo.createBranch(dir, 'kept', second, false)
    expect((await getReflog(dir)).entries.find((e) => e.hash === second)?.lost).toBe(false)
  })

  it('lists the latest entries only, and says there are more', async () => {
    for (const n of [1, 2, 3]) await commitFile('a.txt', `${n}\n`, `commit ${n}`)
    const { entries, more } = await getReflog(dir, 2)
    expect(entries.map((e) => e.subject)).toEqual(['commit 3', 'commit 2'])
    expect(more).toBe(true)
  })

  it('is empty in a repository without commits', async () => {
    expect(await getReflog(dir)).toEqual({ entries: [], more: false })
  })

  it('counts a commit only the checked-out HEAD has (detached) as not lost', async () => {
    await commitFile('a.txt', 'one\n', 'first')
    await git(['checkout', '-q', '--detach'], { cwd: dir })
    const detached = await commitFile('a.txt', 'two\n', 'detached work')
    const { entries } = await getReflog(dir)
    expect(entries[0]).toMatchObject({ hash: detached, lost: false })
  })
})

describe('reading reflog entries', () => {
  it('reads the time from the selector and splits the action from what git says of it', () => {
    const hash = 'a'.repeat(40)
    const out = `${hash}\x1fHEAD@{1700000000}\x1fcheckout: moving from a to b\x1fsubject\n\x1e\n${hash}\x1fHEAD@{1700000001}\x1fodd\x1fs\x1e`
    expect(parseReflog(out)).toEqual([
      { index: 0, hash, date: 1700000000, action: 'checkout', detail: 'moving from a to b', subject: 'subject' },
      { index: 1, hash, date: 1700000001, action: 'odd', detail: '', subject: 's' }
    ])
  })

  it('names the kind of each move', () => {
    expect(reflogKind('commit')).toBe('commit')
    expect(reflogKind('commit (initial)')).toBe('commit')
    expect(reflogKind('commit (amend)')).toBe('amend')
    expect(reflogKind('rebase -i (finish)')).toBe('rebase')
    expect(reflogKind('pull --rebase (start)')).toBe('pull')
    expect(reflogKind('switch')).toBe('checkout')
    expect(reflogKind('cherry-pick')).toBe('cherry-pick')
    expect(reflogKind('branch')).toBe('other')
  })
})
