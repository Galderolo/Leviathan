import type { Account } from '../../shared/types'
import type { AccountStore, Renewal } from './store'

/** Renewed this long before the access token expires, so a push that starts now does not fail halfway. */
const MARGIN_MS = 5 * 60 * 1000

export type Renew = (account: Account, refreshToken: string) => Promise<Renewal & { accessToken: string }>

/**
 * An account's token, renewed first when it expires soon (GitLab sign-in). GitLab replaces the renewal token on
 * each renewal, so one renewal at a time per account: callers asking meanwhile share it.
 */
export class TokenSource {
  private renewing = new Map<string, Promise<string>>()

  constructor(
    private readonly store: AccountStore,
    private readonly renew: Renew,
    private readonly now: () => number = Date.now
  ) {}

  async token(id: string): Promise<string | null> {
    const account = this.store.get(id)
    if (!account) return null
    const renewal = this.store.renewal(id)
    if (!renewal || renewal.expiresAt - this.now() > MARGIN_MS) return this.store.token(id)
    let pending = this.renewing.get(id)
    if (!pending) {
      pending = this.renew(account, renewal.refreshToken)
        .then((next) => {
          this.store.setToken(id, next.accessToken, { refreshToken: next.refreshToken, expiresAt: next.expiresAt })
          return next.accessToken
        })
        .finally(() => this.renewing.delete(id))
      this.renewing.set(id, pending)
    }
    return pending
  }
}
