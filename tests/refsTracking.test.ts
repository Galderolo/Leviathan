import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shortUpstream, staleTracking } from '../src/main/git/refs'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import type { GitRef } from '../src/shared/types'

describe('shortUpstream', () => {
  it('names upstreams the way the app names branches', () => {
    expect(shortUpstream('refs/remotes/origin/feature/x')).toBe('origin/feature/x')
    expect(shortUpstream('refs/heads/main')).toBe('main')
    expect(shortUpstream('')).toBe('')
  })
})

describe('staleTracking', () => {
  it('recomputes only branches whose tip or upstream moved, and new ones', () => {
    const known = new Map([
      ['refs/heads/a', { key: 'h1 u1', track: '[ahead 1]' }],
      ['refs/heads/b', { key: 'h2 old', track: '' }]
    ])
    const branches = [
      { ref: 'refs/heads/a', key: 'h1 u1' },
      { ref: 'refs/heads/b', key: 'h2 u2' },
      { ref: 'refs/heads/c', key: 'h3 gone' }
    ]
    expect(staleTracking(branches, known)).toEqual(['refs/heads/b', 'refs/heads/c'])
    expect(staleTracking(branches, new Map())).toEqual(['refs/heads/a', 'refs/heads/b', 'refs/heads/c'])
  })
})

let root: string
let work: string

async function commit(dir: string, name: string) {
  writeFileSync(join(dir, name), name)
  await git(['add', '--', name], { cwd: dir })
  await git(['commit', '-q', '-m', name], { cwd: dir })
}

async function configure(dir: string) {
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
}

const branch = async (name: string): Promise<GitRef> =>
  (await repo.getState(work)).refs.find((r) => r.type === 'head' && r.name === name)!

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-track-'))
  await git(['init', '-q', '--bare', '-b', 'main', join(root, 'origin.git')], { cwd: root })
  work = await repo.initRepo(join(root, 'work'), 'main')
  await configure(work)
  await commit(work, 'a.txt')
  await git(['remote', 'add', 'origin', join(root, 'origin.git')], { cwd: work })
  await git(['push', '-q', '-u', 'origin', 'main'], { cwd: work })
  await git(['branch', 'feature'], { cwd: work })
  await git(['push', '-q', '-u', 'origin', 'feature'], { cwd: work })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('ahead/behind across refreshes', () => {
  it('follows commits, fetches and deleted upstreams', async () => {
    expect((await branch('main')).ahead ?? 0).toBe(0)
    await commit(work, 'b.txt')
    expect((await branch('main')).ahead).toBe(1)
    // Nothing moved: same answer from the second refresh.
    expect((await branch('main')).ahead).toBe(1)

    const other = join(root, 'other')
    await git(['clone', '-q', join(root, 'origin.git'), other], { cwd: root })
    await configure(other)
    await commit(other, 'c.txt')
    await commit(other, 'd.txt')
    await git(['push', '-q', 'origin', 'main'], { cwd: other })
    await git(['push', '-q', 'origin', '--delete', 'feature'], { cwd: other })
    await git(['fetch', '-q', '--prune', 'origin'], { cwd: work })

    const main = await branch('main')
    expect([main.ahead, main.behind]).toEqual([1, 2])
    expect((await branch('feature')).upstreamGone).toBe(true)
  })

  it('stays right with more branches than one batch', async () => {
    const tip = (await git(['rev-parse', 'HEAD'], { cwd: work })).stdout.trim()
    const names = Array.from({ length: 230 }, (_, i) => `topic/t${i}`)
    await git(['update-ref', '--stdin'], {
      cwd: work,
      input: names.map((n) => `create refs/heads/${n} ${tip}\ncreate refs/remotes/origin/${n} ${tip}\n`).join('')
    })
    appendFileSync(
      join(work, '.git', 'config'),
      names.map((n) => `[branch "${n}"]\n\tremote = origin\n\tmerge = refs/heads/${n}\n`).join('')
    )
    expect((await branch('topic/t7')).ahead ?? 0).toBe(0)
    await git(['checkout', '-q', 'topic/t7'], { cwd: work })
    await commit(work, 'e.txt')
    const refs = (await repo.getState(work)).refs
    expect(refs.find((r) => r.name === 'topic/t7')?.ahead).toBe(1)
    expect(refs.find((r) => r.name === 'topic/t8')?.ahead ?? 0).toBe(0)
    expect(refs.filter((r) => r.type === 'head' && r.upstream).length).toBe(232)
  })
})
