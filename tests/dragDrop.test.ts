import { describe, expect, it } from 'vitest'
import { dropActions } from '../src/renderer/src/dragDrop'
import type { GitRef } from '../src/shared/types'

const local = (name: string): GitRef => ({ name, fullName: `refs/heads/${name}`, type: 'head', hash: name })
const remote = (name: string): GitRef => ({
  name,
  fullName: `refs/remotes/${name}`,
  type: 'remote',
  hash: name,
  remote: name.split('/')[0]
})
const tag = (name: string): GitRef => ({ name, fullName: `refs/tags/${name}`, type: 'tag', hash: name })

describe('dropActions', () => {
  it('offers merge and rebase when dropping onto the current branch', () => {
    expect(dropActions(local('feature'), local('main'), 'main')).toEqual([
      { kind: 'merge', from: 'feature', into: 'main' },
      { kind: 'rebase', branch: 'main', onto: 'feature' }
    ])
    expect(dropActions(remote('origin/feature'), local('main'), 'main')[0]).toEqual({
      kind: 'merge',
      from: 'origin/feature',
      into: 'main'
    })
  })

  it('offers rebase and checkout-then-merge when dragging the current branch', () => {
    expect(dropActions(local('feature'), local('main'), 'feature')).toEqual([
      { kind: 'rebase', branch: 'feature', onto: 'main' },
      { kind: 'checkoutMerge', from: 'feature', into: 'main' }
    ])
    expect(dropActions(local('feature'), remote('origin/main'), 'feature')).toEqual([
      { kind: 'rebase', branch: 'feature', onto: 'origin/main' }
    ])
  })

  it('offers checkout-then-merge between two other local branches', () => {
    expect(dropActions(local('a'), local('b'), 'main')).toEqual([{ kind: 'checkoutMerge', from: 'a', into: 'b' }])
  })

  it('offers nothing for impossible drops', () => {
    expect(dropActions(local('main'), local('main'), 'main')).toEqual([])
    expect(dropActions(local('a'), tag('v1'), 'main')).toEqual([])
    expect(dropActions(local('a'), remote('origin/b'), 'main')).toEqual([])
  })
})
