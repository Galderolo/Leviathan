import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { git, setRepoGitArgs } from '../src/main/git/runner'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs) setRepoGitArgs(d, null)
  rmSync(dirs[0], { recursive: true, force: true })
  dirs.length = 0
})

describe('per-repository git arguments', () => {
  it('a repository inside another (a submodule in its own tab) uses its own account', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'leviathan-args-'))
    const child = join(parent, 'libs', 'engine')
    mkdirSync(join(child, 'src'), { recursive: true })
    dirs.push(parent, child)
    // Bound in this order on purpose: the outer repository first.
    setRepoGitArgs(parent, ['-c', 'user.name=Parent account'])
    setRepoGitArgs(child, ['-c', 'user.name=Engine account'])
    const name = async (cwd: string) => (await git(['config', 'user.name'], { cwd })).stdout.trim()
    expect(await name(child)).toBe('Engine account')
    expect(await name(join(child, 'src'))).toBe('Engine account')
    expect(await name(parent)).toBe('Parent account')
    expect(await name(join(parent, 'libs'))).toBe('Parent account')
  })
})
