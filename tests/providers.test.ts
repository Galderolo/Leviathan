import { describe, expect, it } from 'vitest'
import {
  GITHUB_SCOPES,
  apiBase,
  credentialArgs,
  hasRemoteOnHost,
  noreplyEmail,
  tokenPageUrl,
  withoutAccount
} from '../src/shared/providers'

describe('provider helpers', () => {
  it('builds API base URLs, including self-hosted instances', () => {
    expect(apiBase('github', 'github.com')).toBe('https://api.github.com')
    expect(apiBase('github', 'git.acme.com')).toBe('https://git.acme.com/api/v3')
    expect(apiBase('gitlab', 'gitlab.com')).toBe('https://gitlab.com/api/v4')
    expect(apiBase('gitea', 'code.example.org')).toBe('https://code.example.org/api/v1')
    expect(apiBase('other', 'x')).toBeNull()
  })

  it('uses the provider no-reply address so real emails stay private', () => {
    expect(noreplyEmail('github', 'github.com', 9107463, 'Galderolo')).toBe(
      '9107463+Galderolo@users.noreply.github.com'
    )
    expect(noreplyEmail('github', 'git.acme.com', 5, 'ana')).toBe('5+ana@users.noreply.git.acme.com')
    expect(noreplyEmail('gitlab', 'gitlab.com', 42, 'ana')).toBe('42-ana@users.noreply.gitlab.com')
    expect(noreplyEmail('gitea', 'code.example.org', 7, 'ana')).toBe('ana@noreply.code.example.org')
  })

  it('links to the page where a token is created', () => {
    expect(tokenPageUrl('github', 'github.com')).toBe(
      'https://github.com/settings/tokens/new?scopes=repo,workflow,read:user&description=Leviathan'
    )
    expect(tokenPageUrl('gitlab', 'gitlab.com')).toBe(
      'https://gitlab.com/-/user_settings/personal_access_tokens?name=Leviathan&scopes=api,read_user,write_repository'
    )
    expect(tokenPageUrl('gitea', 'h')).toBe('https://h/user/settings/applications')
    expect(tokenPageUrl('other', 'h')).toBeNull()
  })

  it('disables other credential helpers for the account host and pins the username', () => {
    expect(credentialArgs({ host: 'github.com', username: 'ana' })).toEqual([
      '-c',
      'credential.https://github.com.helper=',
      '-c',
      'credential.https://github.com.username=ana'
    ])
  })

  it('drops every binding to a removed account', () => {
    expect(withoutAccount({ a: '1', b: '2', c: '1' }, '1')).toEqual({ b: '2' })
  })
})

describe('hasRemoteOnHost', () => {
  const remote = (url: string) => ({ name: 'origin', fetchUrl: url, pushUrl: url })
  it('matches HTTPS and SSH remotes on the host, ignoring case', () => {
    expect(hasRemoteOnHost([remote('https://GitHub.com/ana/app.git')], 'github.com')).toBe(true)
    expect(hasRemoteOnHost([remote('git@github.com:ana/app.git')], 'github.com')).toBe(true)
  })
  it('does not match other hosts or hosts that only share a suffix', () => {
    expect(hasRemoteOnHost([remote('https://gitlab.com/ana/app.git')], 'github.com')).toBe(false)
    expect(hasRemoteOnHost([remote('https://notgithub.com/ana/app.git')], 'github.com')).toBe(false)
    expect(hasRemoteOnHost([], 'github.com')).toBe(false)
  })
})

describe('GitHub sign-in permissions', () => {
  it('match the token page, including pushes that change workflows', () => {
    expect(GITHUB_SCOPES.split(' ').sort()).toEqual(['read:user', 'repo', 'workflow'])
  })
})
