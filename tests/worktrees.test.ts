import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { addWorktree, getWorktrees, pruneWorktrees, removeWorktree } from '../src/main/git/worktrees'
import { parseWorktrees, worktreeFolder } from '../src/shared/worktrees'

let root: string
let dir: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-test-'))
  dir = await repo.initRepo(join(root, 'game'), 'main')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  await repo.stage(dir, ['a.txt'])
  await repo.commit(dir, 'first', false)
  await repo.createBranch(dir, 'develop', null, false)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('parseWorktrees', () => {
  it("reads git's list: the main folder first, branches, detached heads, locked and gone ones", () => {
    const out = [
      'worktree D:/Projects/Game',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree D:/Projects/Game-develop',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/develop',
      'locked',
      '',
      'worktree D:/Projects/Game-check',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n')
    expect(parseWorktrees(out)).toEqual([
      { path: 'D:/Projects/Game', head: '1'.repeat(40), branch: 'main', main: true, locked: false, prunable: false },
      {
        path: 'D:/Projects/Game-develop',
        head: '2'.repeat(40),
        branch: 'develop',
        main: false,
        locked: true,
        prunable: false
      },
      { path: 'D:/Projects/Game-check', head: '3'.repeat(40), branch: null, main: false, locked: false, prunable: true }
    ])
  })
})

describe('worktreeFolder', () => {
  it('names a folder next to the repository after the branch', () => {
    expect(worktreeFolder('D:\\Projects\\Game', 'feature/ui')).toBe('D:\\Projects\\Game-feature-ui')
    expect(worktreeFolder('/home/ana/game/', 'fix: crash')).toBe('/home/ana/game-fix-crash')
  })
})

describe('worktrees', () => {
  const other = () => join(root, 'game-develop')

  it('lists the repository folder alone at first, as the current one', async () => {
    expect(await getWorktrees(dir)).toMatchObject([{ branch: 'main', main: true, current: true }])
  })

  it('checks a branch out in a folder of its own, and lists it', async () => {
    const path = await addWorktree(dir, other(), 'develop')
    expect(existsSync(join(path, 'a.txt'))).toBe(true)
    const list = await getWorktrees(dir)
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ branch: 'develop', main: false, current: false })
    // From the new folder, that one is the current one.
    expect((await getWorktrees(path)).map((w) => w.current)).toEqual([false, true])
  })

  it('makes a local branch following a remote one', async () => {
    const tip = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    await git(['remote', 'add', 'origin', 'https://example.com/game.git'], { cwd: dir })
    await git(['update-ref', 'refs/remotes/origin/feature/ui', tip], { cwd: dir })

    const path = await addWorktree(dir, join(root, 'game-ui'), 'origin/feature/ui', true)
    expect((await getWorktrees(dir))[1]).toMatchObject({ branch: 'feature/ui' })
    expect((await git(['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: path })).stdout.trim()).toBe(
      'origin/feature/ui'
    )
  })

  it('removes a worktree, but asks for force when it has changes', async () => {
    const path = await addWorktree(dir, other(), 'develop')
    writeFileSync(join(path, 'a.txt'), 'changed there\n')
    await expect(removeWorktree(dir, path, false)).rejects.toThrow(/--force/)
    await removeWorktree(dir, path, true)
    expect(existsSync(path)).toBe(false)
    expect(await getWorktrees(dir)).toHaveLength(1)
  })

  it('never removes the folder the repository is open from', async () => {
    await expect(removeWorktree(dir, dir, true)).rejects.toThrow()
    expect(existsSync(join(dir, 'a.txt'))).toBe(true)
  })

  it('forgets a worktree whose folder was deleted by hand', async () => {
    const path = await addWorktree(dir, other(), 'develop')
    rmSync(path, { recursive: true, force: true })
    expect((await getWorktrees(dir))[1]).toMatchObject({ prunable: true })
    await pruneWorktrees(dir)
    expect(await getWorktrees(dir)).toHaveLength(1)
  })

  it('refuses a folder that is not a full path, or a name that could be an option', async () => {
    await expect(addWorktree(dir, 'relative/place', 'develop')).rejects.toThrow()
    await expect(addWorktree(dir, other(), '--detach')).rejects.toThrow()
  })
})
