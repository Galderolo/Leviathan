import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKey, listKeys } from '../src/main/ssh'

let sshDir: string

beforeEach(() => {
  sshDir = join(mkdtempSync(join(tmpdir(), 'leviathan-ssh-')), '.ssh')
})

afterEach(() => {
  rmSync(join(sshDir, '..'), { recursive: true, force: true })
})

describe('ssh keys', () => {
  it('lists nothing when the folder does not exist', async () => {
    expect(await listKeys(sshDir)).toEqual([])
  })

  it('generates an ed25519 key and lists it', async () => {
    const key = await generateKey({ email: 'ana@example.com', passphrase: '', fileName: 'id_test' }, sshDir)
    expect(key).toMatchObject({ type: 'ssh-ed25519', comment: 'ana@example.com', path: join(sshDir, 'id_test.pub') })
    expect(key.publicKey).toMatch(/^ssh-ed25519 \S+ ana@example\.com$/)
    expect(await listKeys(sshDir)).toEqual([key])
  })

  it('refuses to overwrite an existing key', async () => {
    await generateKey({ email: 'a@b.c', passphrase: '', fileName: 'id_test' }, sshDir)
    await expect(generateKey({ email: 'a@b.c', passphrase: '', fileName: 'id_test' }, sshDir)).rejects.toThrow(
      /already exists/
    )
  })

  it('rejects file names that could escape the folder', async () => {
    await expect(generateKey({ email: 'a@b.c', passphrase: '', fileName: '../evil' }, sshDir)).rejects.toThrow(
      /Invalid key file name/
    )
  })
})
