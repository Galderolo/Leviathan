import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKey, listKeys } from '../src/main/ssh'

// Every program started, to check what goes on a command line.
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return { ...real, spawn: vi.fn(real.spawn) }
})

const ASKPASS = { scriptDir: join(__dirname, '..', 'resources', 'askpass'), nodePath: process.execPath }

let sshDir: string

beforeEach(() => {
  sshDir = join(mkdtempSync(join(tmpdir(), 'leviathan-ssh-')), '.ssh')
  vi.mocked(spawn).mockClear()
})

afterEach(() => {
  rmSync(join(sshDir, '..'), { recursive: true, force: true })
})

/** Whether the private key opens with `passphrase`. */
function opens(keyPath: string, passphrase: string): boolean {
  return spawnSync('ssh-keygen', ['-y', '-P', passphrase, '-f', keyPath], { stdio: 'ignore' }).status === 0
}

describe('ssh keys', () => {
  it('lists nothing when the folder does not exist', async () => {
    expect(await listKeys(sshDir)).toEqual([])
  })

  it('generates an ed25519 key and lists it', async () => {
    const key = await generateKey({ email: 'ana@example.com', passphrase: '', fileName: 'id_test' }, ASKPASS, sshDir)
    expect(key).toMatchObject({ type: 'ssh-ed25519', comment: 'ana@example.com', path: join(sshDir, 'id_test.pub') })
    expect(key.publicKey).toMatch(/^ssh-ed25519 \S+ ana@example\.com$/)
    expect(await listKeys(sshDir)).toEqual([key])
    expect(opens(join(sshDir, 'id_test'), '')).toBe(true)
  })

  it('protects the key with the passphrase, which never goes on a command line', async () => {
    const passphrase = 'correct horse & "battery" %PATH% (staple)'
    await generateKey({ email: 'ana@example.com', passphrase, fileName: 'id_test' }, ASKPASS, sshDir)
    expect(opens(join(sshDir, 'id_test'), '')).toBe(false)
    expect(opens(join(sshDir, 'id_test'), passphrase)).toBe(true)
    const commandLines = vi.mocked(spawn).mock.calls.map((call) => JSON.stringify(call[1] ?? []))
    expect(commandLines.length).toBeGreaterThan(0)
    expect(commandLines.filter((line) => line.includes('correct horse'))).toEqual([])
  })

  it('creates no key when ssh-keygen cannot take the passphrase', async () => {
    // No askpass scripts there: like an ssh-keygen too old to use them, it ends up with an empty passphrase.
    const broken = { ...ASKPASS, scriptDir: join(sshDir, '..') }
    await expect(
      generateKey({ email: 'a@b.c', passphrase: 'secret', fileName: 'id_test' }, broken, sshDir)
    ).rejects.toThrow(/passphrase/)
    expect(existsSync(join(sshDir, 'id_test'))).toBe(false)
    expect(existsSync(join(sshDir, 'id_test.pub'))).toBe(false)
  })

  it('refuses to overwrite an existing key', async () => {
    await generateKey({ email: 'a@b.c', passphrase: '', fileName: 'id_test' }, ASKPASS, sshDir)
    await expect(generateKey({ email: 'a@b.c', passphrase: '', fileName: 'id_test' }, ASKPASS, sshDir)).rejects.toThrow(
      /already exists/
    )
  })

  it('rejects file names that could escape the folder', async () => {
    await expect(generateKey({ email: 'a@b.c', passphrase: '', fileName: '../evil' }, ASKPASS, sshDir)).rejects.toThrow(
      /Invalid key file name/
    )
  })
})
