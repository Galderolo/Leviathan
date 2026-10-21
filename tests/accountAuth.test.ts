import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { answerFromAccounts } from '../src/main/accounts/auth'
import { startAskpassServer, type AskpassBridge } from '../src/main/askpass/server'
import { git, setRepoGitArgs } from '../src/main/git/runner'
import { credentialArgs } from '../src/shared/providers'
import type { Account } from '../src/shared/types'

const ana: Account = {
  id: '1',
  provider: 'other',
  host: 'example.com',
  username: 'ana',
  name: 'Ana',
  email: 'ana@example.invalid'
}
const accounts = [
  { account: ana, token: 'T0K' },
  { account: { ...ana, id: '2', host: 'other.org', username: 'bo' }, token: 'B0' }
]

describe('answerFromAccounts', () => {
  it('answers the password prompt with the matching account token', () => {
    expect(answerFromAccounts("Password for 'https://ana@example.com': ", accounts)).toBe('T0K')
    expect(answerFromAccounts("Password for 'https://ANA@Example.com': ", accounts)).toBe('T0K')
  })

  it('answers the username prompt when exactly one account exists for the host', () => {
    expect(answerFromAccounts("Username for 'https://example.com': ", accounts)).toBe('ana')
    const two = [...accounts, { account: { ...ana, id: '3', username: 'cy' }, token: 'C' }]
    expect(answerFromAccounts("Username for 'https://example.com': ", two)).toBeNull()
  })

  it('never sends a token over plain http', () => {
    expect(answerFromAccounts("Password for 'http://ana@example.com': ", accounts)).toBeNull()
    expect(answerFromAccounts("Username for 'http://example.com': ", accounts)).toBeNull()
  })

  it('leaves everything else to the user', () => {
    expect(answerFromAccounts("Password for 'https://zed@example.com': ", accounts)).toBeNull()
    expect(answerFromAccounts("Password for 'https://ana@unknown.net': ", accounts)).toBeNull()
    expect(answerFromAccounts('Enter passphrase for key /x/id_ed25519: ', accounts)).toBeNull()
  })
})

describe('repositories bound to an account', () => {
  let dir: string
  let bridge: AskpassBridge | null = null

  afterEach(async () => {
    setRepoGitArgs(dir, null)
    await bridge?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("use the account's token instead of other credential helpers", async () => {
    dir = mkdtempSync(join(tmpdir(), 'leviathan-bound-'))
    await git(['init', '-q'], { cwd: dir })
    // A helper that would answer with someone else's credentials (like a stored manager account).
    await git(['config', 'credential.helper', '!f() { echo username=wrong; echo password=WRONG; }; f'], { cwd: dir })
    bridge = await startAskpassServer(async (prompt) => answerFromAccounts(prompt, accounts), {
      scriptDir: join(__dirname, '..', 'resources', 'askpass'),
      nodePath: process.execPath
    })
    // Ignore the machine's global/system git config (e.g. a credential manager that would open a window).
    const emptyConfig = join(dir, 'empty.gitconfig')
    writeFileSync(emptyConfig, '')
    const isolated = { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GCM_INTERACTIVE: 'never' }
    const fill = () =>
      git(['credential', 'fill'], {
        cwd: dir,
        env: { ...bridge!.env, ...isolated },
        input: 'protocol=https\nhost=example.com\n\n'
      })

    expect((await fill()).stdout).toContain('password=WRONG')

    setRepoGitArgs(dir, credentialArgs(ana))
    const { stdout } = await fill()
    expect(stdout).toContain('username=ana')
    expect(stdout).toContain('password=T0K')
  })
})
