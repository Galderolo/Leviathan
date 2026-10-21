import { describe, expect, it } from 'vitest'
import { branchStartOptions } from '../src/renderer/src/branchStart'
import type { Commit, GitRef, HeadInfo } from '../src/shared/types'

const head: HeadInfo = { branch: 'main', hash: 'aaaaaaa111', detached: false, upstream: null, ahead: 0, behind: 0 }
const refs: GitRef[] = [
  { name: 'main', fullName: 'refs/heads/main', type: 'head', hash: 'aaaaaaa111', isHead: true },
  { name: 'feature', fullName: 'refs/heads/feature', type: 'head', hash: 'bbbbbbb222' },
  { name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', hash: 'aaaaaaa111', remote: 'origin' },
  { name: 'v1.0', fullName: 'refs/tags/v1.0', type: 'tag', hash: 'ccccccc333' }
]
const commits = [{ hash: 'ddddddd444', subject: 'Fix login' }] as Commit[]

describe('branchStartOptions', () => {
  it('starts from the current branch by default, then lists branches, remotes and tags', () => {
    const { options, value } = branchStartOptions(head, refs, commits, null)
    expect(value).toBe('HEAD')
    expect(options).toEqual([
      { value: 'HEAD', label: 'main (HEAD)' },
      { value: 'feature', label: 'feature' },
      { value: 'origin/main', label: 'origin/main' },
      { value: 'v1.0', label: 'v1.0' }
    ])
  })

  it('preselects the commit the branch is created on', () => {
    const { options, value } = branchStartOptions(head, refs, commits, 'ddddddd444')
    expect(value).toBe('ddddddd444')
    expect(options[0]).toEqual({ value: 'ddddddd444', label: 'ddddddd — Fix login' })
  })

  it('uses the branch name when the commit is a branch tip', () => {
    const { options, value } = branchStartOptions(head, refs, commits, 'bbbbbbb222')
    expect(value).toBe('feature')
    expect(options).toHaveLength(4)
  })

  it('describes a detached HEAD by its hash', () => {
    const detached = { ...head, branch: null, detached: true }
    expect(branchStartOptions(detached, refs, commits, null).options[0]).toEqual({
      value: 'HEAD',
      label: 'HEAD (aaaaaaa)'
    })
  })
})
