import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Binding a repository to an account writes the app's settings and the repository's identity; here it fails.
vi.mock('../src/main/accounts', () => ({
  cloneArgsFor: () => [],
  setRepoAccount: async () => {
    throw new Error('settings.json is read-only')
  }
}))

const { cloneWithAccount } = await import('../src/main/clone')
const { git } = await import('../src/main/git/runner')

let root: string
let origin: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-clone-'))
  origin = join(root, 'origin.git')
  await git(['init', '-q', '--bare', '-b', 'main', origin], { cwd: root })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('cloneWithAccount', () => {
  it('keeps a clone that could not be bound to the account, and says why', async () => {
    const result = await cloneWithAccount(origin, join(root, 'work'), 'account-1', false, () => {})
    expect(result).toMatchObject({ bindError: 'settings.json is read-only', submoduleError: null })
    expect(existsSync(join(result.path, '.git'))).toBe(true)
  })

  it('without an account, binds nothing', async () => {
    const result = await cloneWithAccount(origin, join(root, 'plain'), null, false, () => {})
    expect(result).toMatchObject({ bindError: null, submoduleError: null })
  })
})
