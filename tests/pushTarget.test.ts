import { describe, expect, it } from 'vitest'
import {
  amendsPushedCommit,
  pushAfterCommitTarget,
  pushNeedsPull,
  remotesToChooseFrom,
  syncCounts
} from '../src/renderer/src/pushTarget'
import type { GitRef, HeadInfo, Remote } from '../src/shared/types'

describe('syncCounts', () => {
  const state = (ahead: number, behind: number, unpushed: string[] = []) => ({
    head: { branch: 'main', hash: 'h', detached: false, upstream: 'origin/main', ahead, behind },
    unpushed
  })

  it('counts the commits to pull and to push', () => {
    expect(syncCounts(state(2, 3, ['a', 'b']))).toEqual({ pull: 3, push: 2 })
    expect(syncCounts(state(0, 1))).toEqual({ pull: 1, push: 0 })
  })

  it('counts the commits of a branch never pushed as commits to push', () => {
    expect(syncCounts(state(0, 0, ['a', 'b', 'c']))).toEqual({ pull: 0, push: 3 })
  })

  it('is null when there is nothing to pull or push, or the repository is not read yet', () => {
    expect(syncCounts(state(0, 0))).toBeNull()
    expect(syncCounts(null)).toBeNull()
  })
})

describe('pushAfterCommitTarget', () => {
  const info = (branch: string | null, upstream: string | null): HeadInfo => ({
    branch,
    hash: 'h',
    detached: branch === null,
    upstream,
    ahead: 0,
    behind: 0
  })
  const r = (name: string): Remote => ({ name, fetchUrl: name, pushUrl: name })

  it("names the branch's upstream, or where a first push would publish it", () => {
    expect(pushAfterCommitTarget(info('develop', 'origin/develop'), [r('origin')])).toBe('origin/develop')
    expect(pushAfterCommitTarget(info('topic', null), [r('fork'), r('origin')])).toBe('origin/topic')
    expect(pushAfterCommitTarget(info('topic', null), [r('fork')])).toBe('fork/topic')
  })

  it('knows when an amend rewrote a commit that was already pushed', () => {
    const state = { head: info('develop', 'origin/develop'), unpushed: ['new1'] }
    expect(amendsPushedCommit(true, { ...state, head: { ...state.head, hash: 'old' } })).toBe(true)
    expect(amendsPushedCommit(true, { ...state, head: { ...state.head, hash: 'new1' } })).toBe(false)
    expect(amendsPushedCommit(false, { ...state, head: { ...state.head, hash: 'old' } })).toBe(false)
  })

  it('has nothing to push to without a branch or a remote', () => {
    expect(pushAfterCommitTarget(info(null, null), [r('origin')])).toBeNull()
    expect(pushAfterCommitTarget(info('main', null), [])).toBeNull()
  })
})

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

  it('asks when the branch follows the branch it started from and is on no remote yet', () => {
    const remotes = [remote('origin'), remote('upstream')]
    expect(remotesToChooseFrom('feature', [head('feature', 'upstream/main')], remotes)).toEqual(['origin', 'upstream'])
  })

  it('does not ask when the branch is already on a remote', () => {
    const published: GitRef = {
      name: 'origin/feature',
      fullName: 'refs/remotes/origin/feature',
      type: 'remote',
      hash: 'h'
    }
    const remotes = [remote('origin'), remote('upstream')]
    expect(remotesToChooseFrom('feature', [head('feature', 'upstream/main'), published], remotes)).toBeNull()
  })

  it('does not ask when there is only one remote (or none)', () => {
    expect(remotesToChooseFrom('topic', [head('topic')], [remote('origin')])).toBeNull()
    expect(remotesToChooseFrom('topic', [head('topic')], [])).toBeNull()
  })
})

describe('pushNeedsPull', () => {
  it('recognizes a push refused because the remote has commits that are not here yet', () => {
    const fetchFirst = [
      'To https://bitbucket.org/studio/game.git',
      ' ! [rejected]            develop -> develop (fetch first)',
      "error: failed to push some refs to 'https://bitbucket.org/studio/game.git'",
      'hint: Updates were rejected because the remote contains work that you do not'
    ].join('\n')
    expect(pushNeedsPull(fetchFirst)).toBe(true)
    expect(pushNeedsPull(' ! [rejected]        main -> main (non-fast-forward)')).toBe(true)
  })

  it('leaves other refusals alone', () => {
    // A force push with lease refused: pulling would throw away what the user meant to replace.
    expect(pushNeedsPull(' ! [rejected]        main -> main (stale info)')).toBe(false)
    expect(pushNeedsPull(' ! [remote rejected] main -> main (pre-receive hook declined)')).toBe(false)
    expect(pushNeedsPull('fatal: Authentication failed')).toBe(false)
  })
})
