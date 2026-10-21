import type { Account } from '../../shared/types'

export interface AccountCredentials {
  account: Account
  token: string
}

// https only: a token must never be answered to a plain-http remote.
const PASSWORD = /^Password for 'https:\/\/([^@']+)@([^/']+)/i
const USERNAME = /^Username for 'https:\/\/([^/']+)/i

/**
 * Answers git's credential prompts from the stored accounts, so pushes and
 * pulls do not ask anything. Returns null when the user has to answer.
 */
export function answerFromAccounts(prompt: string, accounts: AccountCredentials[]): string | null {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const password = PASSWORD.exec(prompt.trim())
  if (password) {
    const [, user, host] = password
    const match = accounts.find((c) => same(c.account.host, host) && same(c.account.username, decodeURIComponent(user)))
    return match ? match.token : null
  }
  const username = USERNAME.exec(prompt.trim())
  if (username) {
    const candidates = accounts.filter((c) => same(c.account.host, username[1]))
    return candidates.length === 1 ? candidates[0].account.username : null
  }
  return null
}
