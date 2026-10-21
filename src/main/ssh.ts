import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshKey } from '../shared/types'

export function defaultSshDir(): string {
  return join(homedir(), '.ssh')
}

function parsePublicKey(path: string, text: string): SshKey | null {
  const line = text.trim().split(/\r?\n/)[0] ?? ''
  const [type, data, ...comment] = line.split(/\s+/)
  if (!type || !data || !/^(ssh-|ecdsa-|sk-)/.test(type)) return null
  return { path, type, comment: comment.join(' '), publicKey: line }
}

/** Public keys (`*.pub`) in the user's SSH folder. */
export async function listKeys(sshDir = defaultSshDir()): Promise<SshKey[]> {
  let names: string[]
  try {
    names = await fs.readdir(sshDir)
  } catch {
    return []
  }
  const keys: SshKey[] = []
  for (const name of names.filter((n) => n.endsWith('.pub')).sort()) {
    const path = join(sshDir, name)
    const key = parsePublicKey(path, await fs.readFile(path, 'utf8'))
    if (key) keys.push(key)
  }
  return keys
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', (err: NodeJS.ErrnoException) =>
      reject(new Error(err.code === 'ENOENT' ? 'ssh-keygen was not found. Install OpenSSH or Git.' : err.message))
    )
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `ssh-keygen failed (${code})`))
    )
  })
}

/** Creates a new ed25519 key pair; never overwrites an existing key. */
export async function generateKey(
  opts: { email: string; passphrase: string; fileName: string },
  sshDir = defaultSshDir()
): Promise<SshKey> {
  if (!/^[A-Za-z0-9._-]+$/.test(opts.fileName) || opts.fileName.startsWith('.')) {
    throw new Error(`Invalid key file name: ${opts.fileName}`)
  }
  const keyPath = join(sshDir, opts.fileName)
  if (existsSync(keyPath) || existsSync(`${keyPath}.pub`))
    throw new Error(`A key named ${opts.fileName} already exists`)
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 })
  await run('ssh-keygen', ['-q', '-t', 'ed25519', '-C', opts.email, '-N', opts.passphrase, '-f', keyPath])
  const key = parsePublicKey(`${keyPath}.pub`, await fs.readFile(`${keyPath}.pub`, 'utf8'))
  if (!key) throw new Error('ssh-keygen did not produce a public key')
  return key
}
