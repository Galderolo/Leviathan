import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  SIGNING_CONFIG_REGEXP,
  SIGNING_KEYS,
  parseGpgSecretKeys,
  signatureFormat,
  signatureStatus,
  signingFromConfig,
  type CommitSignature,
  type GpgKey,
  type SigningSetting,
  type SigningState
} from '../../shared/signing'
import { defaultSshDir, listKeys } from '../ssh'
import { NON_INTERACTIVE_ENV, git } from './runner'

/** Checking a signature may wait on gpg (a keyserver it is set to ask): past this, it is left unchecked. */
const CHECK_TIMEOUT_MS = 20_000
const GPG_TIMEOUT_MS = 15_000

/** `SHA256:…`, the fingerprint ssh-keygen and git give the key of an SSH public key line; null when it is not one. */
export function sshFingerprint(publicKey: string): string | null {
  const [type = '', data = ''] = publicKey.trim().split(/\s+/)
  if (!/^(ssh-|ecdsa-|sk-)/.test(type) || !/^[A-Za-z0-9+/]+=*$/.test(data)) return null
  return `SHA256:${createHash('sha256').update(Buffer.from(data, 'base64')).digest('base64').replace(/=+$/, '')}`
}

let noSigners: Promise<string> | null = null

/**
 * An empty allowed signers file, in a folder of its own (a fixed name in a shared temp folder could be someone
 * else's, listing keys of their choosing).
 */
function emptyAllowedSigners(): Promise<string> {
  noSigners ??= (async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'leviathan-signers-'))
    const file = join(dir, 'allowed_signers')
    await fs.writeFile(file, '')
    return file.replace(/\\/g, '/')
  })().catch((err: unknown) => {
    noSigners = null
    throw err
  })
  return noSigners
}

async function hasAllowedSigners(repo: string): Promise<boolean> {
  const { stdout, exitCode } = await git(['config', '--path', '--get', 'gpg.ssh.allowedSignersFile'], {
    cwd: repo,
    okCodes: [0, 1]
  })
  const file = stdout.trim()
  return exitCode === 0 && !!file && existsSync(resolve(repo, file))
}

/**
 * A commit's signature and what checking it here finds, or null when it is not signed. git checks an SSH signature
 * only against an allowed signers file: without one, it is checked against none, which still tells a valid signature
 * (by a key nothing vouches for) from a bad one; and when the key is one of the user's own (`sshDir`), that is said.
 */
export async function readSignature(
  repo: string,
  hash: string,
  sshDir = defaultSshDir()
): Promise<CommitSignature | null> {
  if (!hash || hash.startsWith('-')) throw new Error(`Invalid commit: "${hash}"`)
  const raw = await git(['cat-file', 'commit', hash], { cwd: repo })
  const format = signatureFormat(raw.stdout)
  if (!format) return null
  let checked = ''
  try {
    const extra =
      format === 'ssh' && !(await hasAllowedSigners(repo))
        ? ['-c', `gpg.ssh.allowedSignersFile=${await emptyAllowedSigners()}`]
        : []
    const { stdout } = await git([...extra, 'show', '-s', '--format=%G?%x1f%GS%x1f%GK%x1f%GF', hash, '--'], {
      cwd: repo,
      env: NON_INTERACTIVE_ENV,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    })
    checked = stdout.replace(/\r?\n$/, '')
  } catch {
    // gpg missing, or too slow: the signature is there, unchecked
  }
  const [code = '', signer = '', keyId = '', fingerprint = ''] = checked.split('\x1f')
  const signature: CommitSignature = { format, status: signatureStatus(code), signer, key: fingerprint || keyId }
  if (format === 'ssh' && signature.key && (signature.status === 'good' || signature.status === 'valid')) {
    const own = (await listKeys(sshDir)).find((k) => sshFingerprint(k.publicKey) === signature.key)
    if (own) signature.ownKey = own.path
  }
  return signature
}

/** Signing as this repository's config has it and as the global one does (`repo` null: the global only). */
export async function readSigning(repo: string | null): Promise<SigningState> {
  const { stdout } = await git(['config', '--show-scope', '-z', '--get-regexp', SIGNING_CONFIG_REGEXP], {
    cwd: repo ?? homedir(),
    okCodes: [0, 1]
  })
  const state = signingFromConfig(stdout)
  // Away from a repository, a home folder that is one says nothing about the others.
  return repo ? state : { local: null, global: state.global, effective: state.global }
}

/**
 * Makes a repository's commits signed or not (`repo`, its own config), or all repositories' (`repo` null, the global
 * config). `null` takes away the repository's own, so the global one applies.
 */
export async function writeSigning(repo: string | null, setting: SigningSetting | null): Promise<void> {
  const cwd = repo ?? homedir()
  const scope = repo ? '--local' : '--global'
  // Exit code 5: it was not set.
  const unset = (key: string) => git(['config', scope, '--unset-all', key], { cwd, okCodes: [0, 5] })
  const set = (key: string, value: string) => git(['config', scope, key, value], { cwd })
  if (!setting) {
    if (!repo) throw new Error('The global config has no other to fall back on')
    for (const key of SIGNING_KEYS) await unset(key)
    return
  }
  if (setting.key.startsWith('-') || /[\r\n]/.test(setting.key))
    throw new Error(`Invalid signing key: "${setting.key}"`)
  await set('commit.gpgsign', String(setting.sign))
  if (!setting.sign) return
  await set('gpg.format', setting.format)
  if (setting.key) await set('user.signingkey', setting.key)
  else await unset('user.signingkey')
}

/** The gpg git signs with: the one its config names, else on Windows the one git for Windows ships, else gpg. */
async function gpgProgram(cwd: string): Promise<string> {
  for (const key of ['gpg.openpgp.program', 'gpg.program']) {
    const { stdout, exitCode } = await git(['config', '--path', '--get', key], { cwd, okCodes: [0, 1] })
    if (exitCode === 0 && stdout.trim()) return stdout.trim()
  }
  if (process.platform === 'win32') {
    // Its usr\bin, where it keeps gpg, is on the PATH of what git runs only.
    const exec = (await git(['--exec-path'], { cwd })).stdout.trim()
    const bundled = resolve(exec, '..', '..', '..', 'usr', 'bin', 'gpg.exe')
    if (existsSync(bundled)) return bundled
  }
  return 'gpg'
}

/** The secret OpenPGP keys that can sign, as the gpg git uses sees them; none when there is no gpg. */
export async function listGpgKeys(repo: string | null): Promise<GpgKey[]> {
  // Without a folder of keys there are none: gpg is not even started (it would start its agent, to stay).
  if (!gpgHomes().some((home) => existsSync(home))) return []
  const cwd = repo ?? homedir()
  const program = await gpgProgram(cwd).catch(() => 'gpg')
  const out = await new Promise<string>((done) => {
    const child = spawn(program, ['--batch', '--no-tty', '--list-secret-keys', '--with-colons'], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let stdout = ''
    let finished = false
    const finish = (text: string) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      child.stdout.destroy()
      done(text)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish('')
    }, GPG_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.on('error', () => finish(''))
    // The agent gpg starts may hold its output open after gpg has ended: what it wrote is read, without waiting.
    child.on('exit', (code) => setTimeout(() => finish(code === 0 ? stdout : ''), DRAIN_MS))
    child.on('close', (code) => finish(code === 0 ? stdout : ''))
  })
  return parseGpgSecretKeys(out)
}

/** How long the output of a program that has ended is still read. */
const DRAIN_MS = 200

/** Where gpg keeps its keys: GNUPGHOME, ~/.gnupg, and on Windows the one of GnuPG's own installer (Gpg4win). */
function gpgHomes(): string[] {
  // git for Windows' gpg takes HOME when it is set, which may not be the user's profile folder.
  const homes = [process.env.GNUPGHOME, process.env.HOME && join(process.env.HOME, '.gnupg'), join(homedir(), '.gnupg')]
  if (process.platform === 'win32' && process.env.APPDATA) homes.push(join(process.env.APPDATA, 'gnupg'))
  return homes.filter((home): home is string => !!home)
}
