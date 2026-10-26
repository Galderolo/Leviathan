import { describe, expect, it } from 'vitest'
import { commitIdentity, rememberIdentity } from '../src/shared/identity'
import type { Account } from '../src/shared/types'

const ana: Account = {
  id: 'a1',
  provider: 'github',
  host: 'github.com',
  username: 'ana',
  name: 'Ana',
  email: '1+ana@users.noreply.github.com'
}
const none = { name: '', email: '' }

describe('commitIdentity', () => {
  it("is the bound account's while the repository still has the account's name and email", () => {
    const local = { name: 'Ana', email: ana.email }
    expect(commitIdentity(local, local, ana)).toEqual({ ...local, source: 'account', accountId: 'a1' })
  })

  it("is the repository's own when it set one, bound to an account or not", () => {
    const local = { name: 'Ana Work', email: 'ana@studio.com' }
    expect(commitIdentity(local, local, ana)).toEqual({ ...local, source: 'repo', accountId: null })
    expect(commitIdentity(local, local, null)).toMatchObject({ source: 'repo' })
  })

  it('is the global one without one of its own, and none without either', () => {
    const global = { name: 'Ana G', email: 'ana@home.com' }
    expect(commitIdentity(none, global, null)).toEqual({ ...global, source: 'global', accountId: null })
    expect(commitIdentity(none, none, null)).toEqual({ ...none, source: 'none', accountId: null })
  })
})

describe('rememberIdentity', () => {
  it('puts the newest first, once, and keeps five', () => {
    const id = (n: number) => ({ name: `N${n}`, email: `n${n}@x.com` })
    const recent = [1, 2, 3, 4, 5].map(id)
    expect(rememberIdentity(recent, id(3))).toEqual([3, 1, 2, 4, 5].map(id))
    expect(rememberIdentity(recent, id(6))).toEqual([6, 1, 2, 3, 4].map(id))
    // The same email in other letter case is the same identity.
    expect(rememberIdentity([id(1)], { name: 'N1', email: 'N1@X.com' })).toEqual([{ name: 'N1', email: 'N1@X.com' }])
  })
})
