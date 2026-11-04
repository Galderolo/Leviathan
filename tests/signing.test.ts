import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startAskpassServer } from '../src/main/askpass/server'
import * as repo from '../src/main/git/repository'
import { git, setGitEnv } from '../src/main/git/runner'
import { readSignature, readSigning, sshFingerprint, writeSigning } from '../src/main/git/signing'
import {
  configBool,
  parseGpgSecretKeys,
  signatureFormat,
  signatureStatus,
  signingFailed,
  signingFromConfig
} from '../src/shared/signing'

const ASKPASS = { scriptDir: join(__dirname, '..', 'resources', 'askpass'), nodePath: process.execPath }

let root: string
let dir: string
let sshDir: string
const saved = { global: process.env.GIT_CONFIG_GLOBAL, noSystem: process.env.GIT_CONFIG_NOSYSTEM }

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-sign-'))
  sshDir = join(root, '.ssh')
  mkdirSync(sshDir)
  // A global config of its own, never the machine's.
  process.env.GIT_CONFIG_GLOBAL = join(root, 'global.gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
  dir = await repo.initRepo(join(root, 'repo'), 'main')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['core.autocrlf', 'false']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
})

afterEach(() => {
  for (const [name, value] of [
    ['GIT_CONFIG_GLOBAL', saved.global],
    ['GIT_CONFIG_NOSYSTEM', saved.noSystem]
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** A new ed25519 key in the test's ~/.ssh; its public key's file. */
function keygen(name: string, passphrase = ''): string {
  const key = join(sshDir, name)
  const made = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', passphrase, '-C', 'test@example.com', '-f', key])
  expect(made.status).toBe(0)
  return `${key}.pub`
}

async function commitFile(name: string, content: string, noSign = false): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, `add ${name}\n`, false, noSign)
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

const signWith = (key: string) => writeSigning(dir, { sign: true, format: 'ssh', key })

describe('signed commits', () => {
  it('tells an unsigned commit from one signed with SSH, valid and by one of the user’s own keys', async () => {
    const plain = await commitFile('a.txt', 'one\n')
    expect(await readSignature(dir, plain, sshDir)).toBeNull()

    const pub = keygen('id_sign')
    await signWith(pub)
    const signed = await commitFile('b.txt', 'two\n')
    const fingerprint = sshFingerprint(readFileSync(pub, 'utf8'))
    // The fingerprint ssh-keygen itself gives the key.
    const listed = spawnSync('ssh-keygen', ['-lf', pub], { encoding: 'utf8' }).stdout.split(' ')[1]
    expect(fingerprint).toBe(listed)
    // No allowed signers file: valid, by a key nothing vouches for, but the user's own.
    expect(await readSignature(dir, signed, sshDir)).toEqual({
      format: 'ssh',
      status: 'valid',
      signer: '',
      key: fingerprint,
      ownKey: pub
    })
    // Somebody else's ~/.ssh: just a valid signature.
    const elsewhere = join(root, 'other-ssh')
    mkdirSync(elsewhere)
    expect(await readSignature(dir, signed, elsewhere)).toMatchObject({ status: 'valid', key: fingerprint })
    expect((await readSignature(dir, signed, elsewhere))?.ownKey).toBeUndefined()
  })

  it('verifies against the allowed signers file when there is one, and finds a forged commit', async () => {
    const pub = keygen('id_sign')
    await signWith(pub)
    const signed = await commitFile('a.txt', 'one\n')
    const allowed = join(root, 'allowed_signers')
    writeFileSync(allowed, `test@example.com namespaces="git" ${readFileSync(pub, 'utf8').trim()}\n`)
    await git(['config', 'gpg.ssh.allowedSignersFile', allowed], { cwd: dir })
    expect(await readSignature(dir, signed, join(root, 'nowhere'))).toMatchObject({
      format: 'ssh',
      status: 'good',
      signer: 'test@example.com'
    })

    // The same signature on a message changed afterwards.
    const raw = (await git(['cat-file', 'commit', signed], { cwd: dir })).stdout
    const forged = (
      await git(['hash-object', '-t', 'commit', '-w', '--stdin'], {
        cwd: dir,
        input: raw.replace('add a.txt', 'add evil.txt')
      })
    ).stdout.trim()
    expect(await readSignature(dir, forged, sshDir)).toMatchObject({ format: 'ssh', status: 'bad' })
  })

  it('commits unsigned this once when asked, whatever the config says', async () => {
    await signWith(keygen('id_sign'))
    const hash = await commitFile('a.txt', 'one\n', true)
    expect(await readSignature(dir, hash, sshDir)).toBeNull()
  })

  it('fails a commit its key cannot sign, with a message the app tells apart, and commits nothing', async () => {
    await commitFile('a.txt', 'one\n')
    const head = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
    await signWith(join(sshDir, 'missing.pub'))
    writeFileSync(join(dir, 'b.txt'), 'two\n')
    await repo.stage(dir, ['b.txt'])
    const error = await repo.commit(dir, 'b\n', false).then(
      () => null,
      (err: Error) => err
    )
    expect(error).not.toBeNull()
    expect(signingFailed(error!.message)).toBe(true)
    expect((await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()).toBe(head)
  })

  it('signs with a key protected by a passphrase, asked through askpass', async () => {
    const passphrase = 'correct horse & battery'
    await signWith(keygen('id_locked', passphrase))
    const prompts: string[] = []
    const bridge = await startAskpassServer(async (prompt) => {
      prompts.push(prompt)
      return /passphrase/i.test(prompt) ? passphrase : null
    }, ASKPASS)
    setGitEnv(bridge.env)
    try {
      const hash = await commitFile('a.txt', 'one\n')
      expect(await readSignature(dir, hash, sshDir)).toMatchObject({ format: 'ssh', status: 'valid' })
      expect(prompts.some((p) => /passphrase/i.test(p))).toBe(true)
    } finally {
      setGitEnv({})
      await bridge.close()
    }
  })
})

describe('signing settings', () => {
  const local = async (key: string) =>
    (await git(['config', '--local', '--get', key], { cwd: dir, okCodes: [0, 1] })).stdout.trim()

  it('signs every repository from the global config, and a repository its own way', async () => {
    expect(await readSigning(dir)).toEqual({
      local: null,
      global: { sign: false, format: 'openpgp', key: '' },
      effective: { sign: false, format: 'openpgp', key: '' }
    })

    await writeSigning(null, { sign: true, format: 'openpgp', key: 'ABCDEF0123456789' })
    const everywhere = { sign: true, format: 'openpgp', key: 'ABCDEF0123456789' }
    expect(await readSigning(dir)).toEqual({ local: null, global: everywhere, effective: everywhere })
    expect((await readSigning(null)).global).toEqual(everywhere)
    expect(readFileSync(process.env.GIT_CONFIG_GLOBAL!, 'utf8')).toContain('gpgsign = true')

    // Not this one.
    await writeSigning(dir, { sign: false, format: 'openpgp', key: 'ABCDEF0123456789' })
    expect(await readSigning(dir)).toMatchObject({
      local: { sign: false },
      global: everywhere,
      effective: { sign: false }
    })
    // This one with an SSH key.
    await writeSigning(dir, { sign: true, format: 'ssh', key: '/keys/id.pub' })
    expect((await readSigning(dir)).effective).toEqual({ sign: true, format: 'ssh', key: '/keys/id.pub' })

    // Back to the global one: nothing of its own is left.
    await writeSigning(dir, null)
    expect(await readSigning(dir)).toEqual({ local: null, global: everywhere, effective: everywhere })
    for (const key of ['commit.gpgsign', 'gpg.format', 'user.signingkey']) expect(await local(key)).toBe('')
  })

  it('refuses a key that would read as an option', async () => {
    await expect(writeSigning(dir, { sign: true, format: 'ssh', key: '--evil' })).rejects.toThrow()
    await expect(writeSigning(null, null)).rejects.toThrow()
  })
})

describe('reading signatures and signing config', () => {
  it('tells the format from the commit’s header, and only from its own signature', () => {
    const commit = (header: string) => `tree abc\nauthor A <a@b> 1 +0000\n${header}\n\nmessage\n`
    expect(signatureFormat(commit('gpgsig -----BEGIN SSH SIGNATURE-----\n U1NI\n -----END SSH SIGNATURE-----'))).toBe(
      'ssh'
    )
    expect(signatureFormat(commit('gpgsig -----BEGIN PGP SIGNATURE-----\n iQ\n -----END PGP SIGNATURE-----'))).toBe(
      'openpgp'
    )
    expect(signatureFormat(commit('gpgsig-sha256 -----BEGIN SIGNED MESSAGE-----\n MI'))).toBe('x509')
    // A merge of a signed tag carries the tag's signature, not one of its own.
    expect(signatureFormat(commit('mergetag object abc\n -----BEGIN PGP SIGNATURE-----'))).toBeNull()
    expect(signatureFormat('tree abc\n\ngpgsig -----BEGIN PGP SIGNATURE----- in the message\n')).toBeNull()
  })

  it('reads git’s signature letters', () => {
    expect(['G', 'U', 'X', 'Y', 'R', 'B', 'E', 'N', ''].map(signatureStatus)).toEqual([
      'good',
      'valid',
      'expired',
      'expired',
      'revoked',
      'bad',
      'unchecked',
      'unchecked',
      'unchecked'
    ])
  })

  it('reads the signing config of each level, booleans as git reads them', () => {
    expect([null, 'true', 'Yes', 'on', '1', 'false', 'no', 'off', '0', ''].map(configBool)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false
    ])
    const out = [
      'global\0commit.gpgsign\nyes',
      'global\0user.signingkey\nABC',
      'local\0gpg.format\nssh',
      'local\0user.signingkey\n/k/id.pub',
      'local\0commit.gpgsign',
      ''
    ].join('\0')
    expect(signingFromConfig(out)).toEqual({
      local: { sign: true, format: 'ssh', key: '/k/id.pub' },
      global: { sign: true, format: 'openpgp', key: 'ABC' },
      effective: { sign: true, format: 'ssh', key: '/k/id.pub' }
    })
    expect(signingFromConfig('')).toEqual({
      local: null,
      global: { sign: false, format: 'openpgp', key: '' },
      effective: { sign: false, format: 'openpgp', key: '' }
    })
  })

  it('lists the secret GPG keys that can sign', () => {
    const out = [
      'sec:u:255:22:5BE42F39AC6255B0:1793783137:::u:::scSC:::+::ed25519:::0:',
      'fpr:::::::::3FFB162E7CAAFB8E93CACA505BE42F39AC6255B0:',
      'grp:::::::::9DBA19DEC73B330792E6D50A44E9858186C63B93:',
      'uid:u::::1793783137::CD5EDA656F8D3F80D1AC1DC64648891C4A332F07::Ana Example <ana@example.com>::::::::::0:',
      'ssb:u:255:18:1111111111111111:1793783137::::::e:::+::cv25519::',
      'fpr:::::::::AAAA1111111111111111111111111111111111111:',
      // Expired.
      'sec:e:255:22:25BA03D7FBDE3E63:1793783138:1793783139::u:::scSC:::+::ed25519:::0:',
      'fpr:::::::::D4268BA8AA3CDBE7677B10B225BA03D7FBDE3E63:',
      'uid:e::::1793783138::E61A::Old Key <old@example.com>::::::::::0:',
      // Only encrypts.
      'sec:u:255:22:2222222222222222:1793783138:::u:::eE:::+::ed25519:::0:',
      // Its secret part is offline (a stub).
      'sec:u:255:22:3333333333333333:1793783138:::u:::scSC:::#::ed25519:::0:',
      // A revoked user id first, then the one to show, with a colon escaped.
      'sec:u:255:22:4444444444444444:1793783138:::u:::scSC:::+::ed25519:::0:',
      'fpr:::::::::BBBB4444444444444444444444444444444444444:',
      'uid:r::::1793783138::E61B::Gone <gone@example.com>::::::::::0:',
      'uid:u::::1793783138::E61C::Team\\x3a Build <build@example.com>::::::::::0:',
      ''
    ].join('\r\n')
    expect(parseGpgSecretKeys(out)).toEqual([
      {
        id: '5BE42F39AC6255B0',
        fingerprint: '3FFB162E7CAAFB8E93CACA505BE42F39AC6255B0',
        uid: 'Ana Example <ana@example.com>'
      },
      {
        id: '4444444444444444',
        fingerprint: 'BBBB4444444444444444444444444444444444444',
        uid: 'Team: Build <build@example.com>'
      }
    ])
    expect(parseGpgSecretKeys('')).toEqual([])
  })

  it('tells a commit that failed to be signed from other failures', () => {
    expect(signingFailed('error: gpg failed to sign the data\nfatal: failed to write commit object')).toBe(true)
    expect(signingFailed('error: Load key "/k/id": incorrect passphrase supplied to decrypt private key?')).toBe(true)
    expect(signingFailed("error: Couldn't load public key /k/id.pub: No such file or directory?")).toBe(true)
    expect(signingFailed('nothing to commit, working tree clean')).toBe(false)
    expect(signingFailed('Author identity unknown')).toBe(false)
  })

  it('gives an SSH public key the fingerprint git and ssh-keygen give it, and none to anything else', () => {
    expect(
      sshFingerprint('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG5nvP5tFv6RuXkMYsmuCILr8fxj4yF/XwQAzC2rDK7+ a@b')
    ).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
    expect(sshFingerprint('not a key')).toBeNull()
    expect(sshFingerprint('')).toBeNull()
  })
})
