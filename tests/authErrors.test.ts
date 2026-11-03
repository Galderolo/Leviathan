import { describe, expect, it } from 'vitest'
import { authProblem } from '../src/shared/authErrors'

describe('authProblem', () => {
  it('tells credentials the server refused', () => {
    for (const message of [
      "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/Galderolo/MMO.git/'",
      "remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://gitlab.com/a/b.git/'",
      "fatal: unable to access 'https://example.com/r.git/': The requested URL returned error: 403"
    ]) {
      expect(authProblem(message)).toBe('rejected')
    }
  })

  it('tells credentials git had none of', () => {
    expect(authProblem("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe(
      'missing'
    )
  })

  it('is nothing for any other failure', () => {
    expect(authProblem('fatal: repository not found')).toBeNull()
    expect(authProblem('error: failed to push some refs')).toBeNull()
  })
})
