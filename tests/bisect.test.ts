import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { bisectMarks, parseBisectRefs, parseBisectTerms, parseBisectVars, type BisectState } from '../src/shared/bisect'

let dir: string
/** The commits made, oldest first: `c1` … `c8`, the number in `n.txt` each time. */
let commits: string[]

const head = async () => (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
const bisect = async () => (await repo.getState(dir)).bisect

/** Tests the checked-out commit: bad once `n.txt` holds `from` or more. */
async function brokenFrom(from: number): Promise<boolean> {
  const n = Number((await git(['show', 'HEAD:n.txt'], { cwd: dir })).stdout.trim())
  return n >= from
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
  commits = []
  for (let n = 1; n <= 8; n++) {
    writeFileSync(join(dir, 'n.txt'), `${n}\n`)
    await repo.stage(dir, ['n.txt'])
    await repo.commit(dir, `c${n}`, false)
    commits.push(await head())
  }
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('bisect', () => {
  it('goes from the commit that works to the one that does not, and finds the first bad one', async () => {
    expect(await bisect()).toBeNull()
    expect(await repo.bisectStart(dir, 'HEAD', commits[0])).toBeNull()
    const started = await bisect()
    expect(started).toMatchObject({
      start: 'main',
      terms: { bad: 'bad', good: 'good' },
      bad: commits[7],
      good: [commits[0]],
      skipped: [],
      firstBad: null,
      suspects: null
    })
    expect(started!.left).toBeGreaterThan(0)
    expect(started!.steps).toBeGreaterThan(0)
    // Halfway, detached.
    expect((await repo.getState(dir)).head.detached).toBe(true)

    for (let round = 0; round < 6 && !(await bisect())!.firstBad; round++) {
      expect(await repo.bisectMark(dir, (await brokenFrom(6)) ? 'bad' : 'good', null)).toBeNull()
    }
    expect((await bisect())!.firstBad).toBe(commits[5])

    expect(await repo.bisectReset(dir)).toBeNull()
    expect(await bisect()).toBeNull()
    const state = await repo.getState(dir)
    expect(state.head).toMatchObject({ branch: 'main', hash: commits[7] })
  })

  it('marks a commit picked in the graph, not only the one checked out', async () => {
    await repo.bisectStart(dir, 'HEAD', commits[0])
    await repo.bisectMark(dir, 'good', commits[4])
    await repo.bisectMark(dir, 'bad', commits[5])
    expect((await bisect())!.firstBad).toBe(commits[5])
  })

  it('says when only skipped commits are left, and which ones the first bad may be', async () => {
    await repo.bisectStart(dir, commits[3], commits[0])
    for (let round = 0; round < 4 && !(await bisect())!.suspects; round++) {
      expect(await repo.bisectMark(dir, 'skip', null)).toBeNull()
    }
    const state = await bisect()
    expect(state!.firstBad).toBeNull()
    expect([...state!.suspects!].sort()).toEqual([commits[1], commits[2], commits[3]].sort())
  })

  it('tells when changes are in the way: starting does nothing, marking keeps the mark and moves on once they are gone', async () => {
    writeFileSync(join(dir, 'n.txt'), 'mine\n')
    expect(await repo.bisectStart(dir, 'HEAD', commits[0])).toMatchObject({ changed: ['n.txt'] })
    expect(await bisect()).toBeNull()

    await git(['checkout', '-q', '--', 'n.txt'], { cwd: dir })
    await repo.bisectStart(dir, 'HEAD', commits[0])
    const testing = await head()
    writeFileSync(join(dir, 'n.txt'), 'mine\n')
    expect(await repo.bisectMark(dir, 'good', null)).toMatchObject({ changed: ['n.txt'] })
    expect(await head()).toBe(testing)
    expect((await bisect())!.good).toContain(testing)

    await repo.stashSave(dir, null)
    expect(await repo.bisectMark(dir, 'good', null)).toBeNull()
    expect(await head()).not.toBe(testing)
  })

  it('refuses to start again while one is under way, and to mark without one', async () => {
    await expect(repo.bisectMark(dir, 'good', null)).rejects.toThrow(/No bisect/)
    await repo.bisectStart(dir, 'HEAD', commits[0])
    await expect(repo.bisectStart(dir, 'HEAD', commits[1])).rejects.toThrow(/under way/)
    await expect(repo.bisectMark(dir, 'good', '--evil')).rejects.toThrow()
    await expect(repo.bisectMark(dir, 'nice' as 'good', null)).rejects.toThrow()
  })

  it('says so, and finds nothing, when a commit marked good comes after the bad one; a later bad one goes on', async () => {
    await repo.bisectStart(dir, commits[3], commits[0])
    // git keeps the mark and fails ("Some good revs are not ancestors of the bad rev").
    await expect(repo.bisectMark(dir, 'good', commits[6])).rejects.toThrow()
    const state = await bisect()
    expect(state).toMatchObject({ bad: commits[3], firstBad: null, suspects: null, crossed: true })
    expect(state!.good).toContain(commits[6])

    await repo.bisectMark(dir, 'bad', commits[7])
    expect(await bisect()).toMatchObject({ bad: commits[7], firstBad: commits[7], crossed: false })
  })

  it('uses the words a bisect started in a terminal took for good and bad', async () => {
    await git(['bisect', 'start', '--term-new=broken', '--term-old=fixed', 'HEAD', commits[0]], { cwd: dir })
    expect((await bisect())!.terms).toEqual({ bad: 'broken', good: 'fixed' })
    await repo.bisectMark(dir, 'good', commits[4])
    await repo.bisectMark(dir, 'bad', commits[5])
    expect((await bisect())!.firstBad).toBe(commits[5])
  })
})

describe('reading a bisect', () => {
  it("reads git's numbers of what is left", () => {
    expect(
      parseBisectVars("bisect_rev='abc'\nbisect_nr=3\nbisect_good=3\nbisect_bad=2\nbisect_all=7\nbisect_steps=2\n")
    ).toEqual({ rev: 'abc', left: 3, steps: 2, all: 7 })
    expect(parseBisectVars('')).toEqual({ rev: null, left: 0, steps: 0, all: 0 })
  })

  it('reads the terms, and the refs by what they mark', () => {
    expect(parseBisectTerms('new\nold\n')).toEqual({ bad: 'new', good: 'old' })
    expect(parseBisectTerms('')).toEqual({ bad: 'bad', good: 'good' })
    const out = 'b refs/bisect/bad\ng1 refs/bisect/good-g1\ns1 refs/bisect/skip-s1\ng2 refs/bisect/good-g2\n'
    expect(parseBisectRefs(out, { bad: 'bad', good: 'good' })).toEqual({
      bad: 'b',
      good: ['g1', 'g2'],
      skipped: ['s1']
    })
  })

  it('marks the first bad commit once found', () => {
    const state: BisectState = {
      start: 'main',
      terms: { bad: 'bad', good: 'good' },
      bad: 'b',
      good: ['g'],
      skipped: ['s'],
      left: 0,
      steps: 0,
      firstBad: 'b',
      suspects: null,
      crossed: false
    }
    expect([...bisectMarks(state)]).toEqual([
      ['s', 'skip'],
      ['g', 'good'],
      ['b', 'first']
    ])
    expect(bisectMarks({ ...state, firstBad: null }).get('b')).toBe('bad')
    expect(bisectMarks(null).size).toBe(0)
  })
})
