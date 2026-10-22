import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The accounts module runs in Electron's main process: stand in for the parts it uses.
const userData = mkdtempSync(join(tmpdir(), 'leviathan-login-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (data: Buffer) => data.toString().split('').reverse().join('')
  }
}))

const TOKEN = 'gho_from_device_flow'
let authorized = false
vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  if (url === 'https://github.com/login/device/code') {
    return json({
      device_code: 'secret-device-code',
      user_code: 'WXYZ-9876',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 0
    })
  }
  if (url === 'https://github.com/login/oauth/access_token') {
    return json(authorized ? { access_token: TOKEN } : { error: 'authorization_pending' })
  }
  if (url === 'https://api.github.com/user' && init?.headers?.Authorization === `Bearer ${TOKEN}`) {
    return json({ login: 'ana', id: 7, name: 'Ana' })
  }
  return { ok: false, status: 404, json: async () => ({}) }
})

const accounts = await import('../src/main/accounts')

beforeEach(() => {
  authorized = false
  for (const a of accounts.listAccounts()) accounts.removeAccount(a.id)
})
afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('signing in to GitHub from the browser', () => {
  it('shows a code, then adds the account once it is authorized', async () => {
    const started = await accounts.startGitHubLogin()
    expect(started).toEqual({
      userCode: 'WXYZ-9876',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900
    })
    expect(JSON.stringify(started)).not.toContain('secret-device-code')
    setTimeout(() => (authorized = true), 30)
    const account = await accounts.finishGitHubLogin()
    expect(account).toMatchObject({ provider: 'github', host: 'github.com', username: 'ana' })
    expect(JSON.stringify(account)).not.toContain(TOKEN)
    expect(accounts.listAccounts().map((a) => a.username)).toEqual(['ana'])
  })

  it('adds nothing when cancelled while waiting', async () => {
    await accounts.startGitHubLogin()
    const finishing = accounts.finishGitHubLogin()
    setTimeout(() => accounts.cancelGitHubLogin(), 30)
    await expect(finishing).rejects.toThrow(/cancelled/i)
    expect(accounts.listAccounts()).toEqual([])
  })

  it('cancels a previous sign-in when a new one starts', async () => {
    await accounts.startGitHubLogin()
    const first = accounts.finishGitHubLogin()
    await accounts.startGitHubLogin()
    await expect(first).rejects.toThrow(/cancelled/i)
    authorized = true
    expect((await accounts.finishGitHubLogin()).username).toBe('ana')
  })

  it('cannot finish without starting', async () => {
    await expect(accounts.finishGitHubLogin()).rejects.toThrow(/no sign-in/i)
  })
})
