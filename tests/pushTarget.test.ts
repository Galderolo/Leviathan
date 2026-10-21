import { describe, expect, it } from 'vitest'
import { remotesToChooseFrom } from '../src/renderer/src/pushTarget'
import type { GitRef, Remote } from '../src/shared/types'

const remote = (name: string): Remote => ({ name, fetchUrl: name, pushUrl: name })
const head = (name: string, upstream?: string): GitRef => ({
  name,
  fullName: `refs/heads/${name}`,
  type: 'head',
  hash: 'h',
  upstream
})

describe('remotesToChooseFrom', () => {
  it('asks when a branch without upstream could go to several remotes', () => {
    expect(remotesToChooseFrom('topic', [head('topic')], [remote('origin'), remote('fork')])).toEqual([
      'origin',
      'fork'
    ])
  })

  it('does not ask when the branch already tracks a remote branch', () => {
    expect(remotesToChooseFrom('main', [head('main', 'origin/main')], [remote('origin'), remote('fork')])).toBeNull()
  })

  it('does not ask when there is only one remote (or none)', () => {
    expect(remotesToChooseFrom('topic', [head('topic')], [remote('origin')])).toBeNull()
    expect(remotesToChooseFrom('topic', [head('topic')], [])).toBeNull()
  })
})
