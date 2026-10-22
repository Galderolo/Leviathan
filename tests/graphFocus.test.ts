import { describe, expect, it } from 'vitest'
import { ancestry, pullRequestsByRef } from '../src/renderer/src/graphFocus'
import type { Commit, GitRef, PullRequest } from '../src/shared/types'

const ref = (r: Partial<GitRef> & Pick<GitRef, 'name' | 'type'>): GitRef =>
  ({ fullName: r.type === 'head' ? `refs/heads/${r.name}` : `refs/remotes/${r.name}`, hash: 'x', ...r }) as GitRef
const pr = (number: number, sourceBranch: string, fromFork = false) =>
  ({ number, sourceBranch, fromFork, targetBranch: 'main' }) as PullRequest

describe('pullRequestsByRef', () => {
  it('puts each pull request on its remote branch and the local branch that tracks it', () => {
    const refs = [
      ref({ name: 'login', type: 'head', upstream: 'origin/login' }),
      ref({ name: 'origin/login', type: 'remote', remote: 'origin' }),
      ref({ name: 'other', type: 'head' }),
      ref({ name: 'origin/fix', type: 'remote', remote: 'origin' })
    ]
    const map = pullRequestsByRef([pr(12, 'login'), pr(7, 'fix'), pr(9, 'from-a-fork', true)], 'origin', refs)
    expect(map.get('refs/heads/login')).toEqual([12])
    expect(map.get('refs/remotes/origin/login')).toEqual([12])
    expect(map.get('refs/remotes/origin/fix')).toEqual([7])
    expect(map.has('refs/heads/other')).toBe(false)
    expect([...map.values()].flat()).not.toContain(9)
  })

  it('is empty without a remote', () => {
    expect(
      pullRequestsByRef([pr(1, 'a')], null, [ref({ name: 'origin/a', type: 'remote', remote: 'origin' })]).size
    ).toBe(0)
  })
})

describe('ancestry', () => {
  const commit = (hash: string, parents: string[]) => ({ hash, parents }) as Commit
  //  d (topic)   c (main)
  //   \         /
  //    b ------
  //    |
  //    a
  const commits = [commit('d', ['b']), commit('c', ['b']), commit('b', ['a']), commit('a', [])]

  it('is the commit and everything it comes from, among the loaded ones', () => {
    expect([...ancestry(commits, 'd')].sort()).toEqual(['a', 'b', 'd'])
    expect([...ancestry(commits, 'c')].sort()).toEqual(['a', 'b', 'c'])
  })

  it('stops at commits that are not loaded', () => {
    expect([...ancestry([commit('x', ['not-loaded'])], 'x')]).toEqual(['x'])
  })
})
