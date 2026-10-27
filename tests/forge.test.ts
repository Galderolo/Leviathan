import { describe, expect, it } from 'vitest'
import { defaultIdentityAccount, needsPushForPullRequest, parseRemoteUrl, pickProject } from '../src/shared/forge'
import type { Account, Remote } from '../src/shared/types'

describe('parseRemoteUrl', () => {
  it('reads HTTPS URLs, with or without user and .git', () => {
    expect(parseRemoteUrl('https://github.com/Owner/Repo.git')).toEqual({ host: 'github.com', path: 'Owner/Repo' })
    expect(parseRemoteUrl('https://ana@GitLab.com/group/sub/project')).toEqual({
      host: 'gitlab.com',
      path: 'group/sub/project'
    })
    expect(parseRemoteUrl('https://git.example.com:8443/team/app.git/')).toEqual({
      host: 'git.example.com:8443',
      path: 'team/app'
    })
  })

  it('reads SSH URLs in both forms', () => {
    expect(parseRemoteUrl('git@github.com:Owner/Repo.git')).toEqual({ host: 'github.com', path: 'Owner/Repo' })
    expect(parseRemoteUrl('ssh://git@gitlab.example.com:2222/group/sub/project.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'group/sub/project'
    })
  })

  it('returns null for local paths and odd URLs', () => {
    expect(parseRemoteUrl('/srv/git/repo.git')).toBeNull()
    expect(parseRemoteUrl('C:/repos/repo.git')).toBeNull()
    expect(parseRemoteUrl('file:///srv/git/repo.git')).toBeNull()
    expect(parseRemoteUrl('https://github.com/')).toBeNull()
  })
})

const account = (id: string, host: string, provider: Account['provider'] = 'github'): Account => ({
  id,
  provider,
  host,
  username: id,
  name: id,
  email: `${id}@example.com`
})
const remote = (name: string, url: string): Remote => ({ name, fetchUrl: url, pushUrl: url })

describe('defaultIdentityAccount', () => {
  const work = account('work', 'github.com')
  const personal = account('Personal', 'github.com')
  const lab = account('lab', 'gitlab.com', 'gitlab')
  const origin = (url: string) => [remote('origin', url)]
  /** Asked which accounts may push where; `allowed` lists "account:path". */
  const pushes = (...allowed: string[]) => {
    const asked: string[] = []
    const fn = async (a: Account, path: string) => {
      asked.push(`${a.id}:${path}`)
      return allowed.includes(`${a.id}:${path}`)
    }
    return { fn, asked }
  }

  it('takes the account that owns the project, without asking the server', async () => {
    const { fn, asked } = pushes()
    expect(await defaultIdentityAccount(origin('git@github.com:personal/game.git'), [work, personal], fn)).toBe(
      personal
    )
    expect(asked).toEqual([])
  })

  it('takes an account that may push when none owns the project', async () => {
    const { fn, asked } = pushes('work:studio/game')
    expect(await defaultIdentityAccount(origin('https://github.com/studio/game'), [personal, work], fn)).toBe(work)
    expect(asked).toEqual(['Personal:studio/game', 'work:studio/game'])
  })

  it('looks at origin first, and only at accounts on the same host', async () => {
    const remotes = [remote('fork', 'https://gitlab.com/lab/game'), remote('origin', 'https://github.com/work/game')]
    expect(await defaultIdentityAccount(remotes, [lab, work], pushes().fn)).toBe(work)
    expect(await defaultIdentityAccount([remotes[0]], [work], pushes().fn)).toBeNull()
  })

  it('is null when no account owns the project or may push to it', async () => {
    expect(await defaultIdentityAccount(origin('https://github.com/someone/lib'), [work], pushes().fn)).toBeNull()
    expect(await defaultIdentityAccount([], [work], pushes().fn)).toBeNull()
  })
})

describe('pickProject', () => {
  const work = account('work', 'github.com')
  const personal = account('personal', 'github.com')

  it('prefers origin, then the other remotes in order', () => {
    const remotes = [
      remote('upstream', 'https://github.com/up/repo.git'),
      remote('origin', 'git@github.com:me/repo.git')
    ]
    expect(pickProject(remotes, [work], null)).toEqual({ remote: 'origin', account: work, path: 'me/repo' })
    expect(pickProject([remotes[0]], [work], null)).toEqual({ remote: 'upstream', account: work, path: 'up/repo' })
  })

  it('prefers the account the repository is bound to', () => {
    const remotes = [remote('origin', 'https://github.com/me/repo.git')]
    expect(pickProject(remotes, [work, personal], 'personal')?.account).toBe(personal)
    expect(pickProject(remotes, [work, personal], null)?.account).toBe(work)
  })

  it('ignores accounts without API support and remotes on hosts without an account', () => {
    const remotes = [remote('origin', 'https://git.example.com/me/repo.git')]
    expect(pickProject(remotes, [account('o', 'git.example.com', 'other')], null)).toBeNull()
    expect(pickProject(remotes, [work], null)).toBeNull()
  })
})

describe('needsPushForPullRequest', () => {
  const ref = (upstream?: string, extra: { ahead?: number; upstreamGone?: boolean } = {}) => ({
    name: 'feature',
    hash: 'tip',
    upstream,
    ...extra
  })
  const onRemote = (name: string, hash: string) => ({ name, type: 'remote' as const, hash })

  it('is false only when the branch is on the remote under its own name, with nothing left to push', () => {
    expect(needsPushForPullRequest(ref('origin/feature'), 'origin', [])).toBe(false)
  })

  it('is true when the branch is not there yet, is ahead, or its remote branch is gone', () => {
    expect(needsPushForPullRequest(ref(), 'origin', [])).toBe(true)
    expect(needsPushForPullRequest(ref('origin/feature', { ahead: 2 }), 'origin', [])).toBe(true)
    expect(needsPushForPullRequest(ref('origin/feature', { upstreamGone: true }), 'origin', [])).toBe(true)
  })

  it('is true when it tracks a branch with another name or on another remote', () => {
    // A branch created from origin/main tracks main: a pull request "from" it would come from main.
    expect(needsPushForPullRequest(ref('origin/main'), 'origin', [])).toBe(true)
    expect(needsPushForPullRequest(ref('fork/feature'), 'origin', [])).toBe(true)
  })

  it('looks at the branch of its name when it follows another branch on purpose', () => {
    expect(needsPushForPullRequest(ref('origin/develop'), 'origin', [onRemote('origin/feature', 'tip')])).toBe(false)
    expect(needsPushForPullRequest(ref('origin/develop'), 'origin', [onRemote('origin/feature', 'older')])).toBe(true)
  })
})
