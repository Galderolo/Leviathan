import { describe, expect, it } from 'vitest'
import {
  amendsPushedCommit,
  pushAfterCommitTarget,
  pushNeedsPull,
  remotesToChooseFrom
} from '../src/renderer/src/pushTarget'
import type { GitRef, HeadInfo, Remote } from '../src/shared/types'

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
