import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshKey } from '../shared/types'
import { startAskpassServer, type AskpassOptions } from './askpass/server'

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

function run(command: string, args: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: env && { ...process.env, ...env }
    })
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

/**
 * Runs ssh-keygen to create `keyPath` protected by `passphrase`, which it asks for through askpass: on the command
 * line (`-N`) any user of the machine could read it while ssh-keygen runs.
 */
async function keygenWithPassphrase(args: string[], keyPath: string, passphrase: string, askpass: AskpassOptions) {
  const bridge = await startAskpassServer(async (prompt) => (/passphrase/i.test(prompt) ? passphrase : null), askpass)
  try {
    // Windows' own ssh-keygen starts askpass with CreateProcess, which runs a .cmd but not a shell script.
    const env =
      process.platform === 'win32' ? { ...bridge.env, SSH_ASKPASS: join(askpass.scriptDir, 'askpass.cmd') } : bridge.env
    await run('ssh-keygen', [...args, '-f', keyPath], env)
  } finally {
    await bridge.close()
  }
  // Before OpenSSH 8.4 (no SSH_ASKPASS_REQUIRE), or when askpass fails, ssh-keygen may go on with an empty passphrase.
  const unprotected = await run('ssh-keygen', ['-y', '-P', '', '-f', keyPath]).then(
    () => true,
    () => false
  )
  if (unprotected) {
    await Promise.all([fs.rm(keyPath, { force: true }), fs.rm(`${keyPath}.pub`, { force: true })])
    throw new Error('ssh-keygen could not take the passphrase (OpenSSH 8.4 or newer is needed). No key was created.')
  }
}

/** Creates a new ed25519 key pair; never overwrites an existing key. */
export async function generateKey(
  opts: { email: string; passphrase: string; fileName: string },
  askpass: AskpassOptions,
  sshDir = defaultSshDir()
): Promise<SshKey> {
  if (!/^[A-Za-z0-9._-]+$/.test(opts.fileName) || opts.fileName.startsWith('.')) {
    throw new Error(`Invalid key file name: ${opts.fileName}`)
  }
  const keyPath = join(sshDir, opts.fileName)
  if (existsSync(keyPath) || existsSync(`${keyPath}.pub`))
    throw new Error(`A key named ${opts.fileName} already exists`)
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 })
  const args = ['-q', '-t', 'ed25519', '-C', opts.email]
  if (opts.passphrase) await keygenWithPassphrase(args, keyPath, opts.passphrase, askpass)
  else await run('ssh-keygen', [...args, '-N', '', '-f', keyPath])
  const key = parsePublicKey(`${keyPath}.pub`, await fs.readFile(`${keyPath}.pub`, 'utf8'))
  if (!key) throw new Error('ssh-keygen did not produce a public key')
  return key
}
