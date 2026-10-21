import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface AskpassBridge {
  /** Environment variables that route git/ssh prompts to the handler. */
  env: Record<string, string>
  close(): Promise<void>
}

export interface AskpassOptions {
  /** Folder containing `askpass.sh` and `askpass-client.js` (must not be inside an asar archive). */
  scriptDir: string
  /** Executable that runs the client script as Node (Electron's own binary in the app). */
  nodePath: string
}

/** Returns the answer, or null when the user cancels. */
export type AskpassHandler = (prompt: string) => Promise<string | null>

const MAX_BODY = 64 * 1024

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
      if (data.length > MAX_BODY) reject(new Error('Request too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sameToken(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

/**
 * Starts a local HTTP server on a named pipe / unix socket that git's and
 * ssh's askpass hooks talk to, so credential, passphrase and host-key prompts
 * can be answered from the app instead of a terminal we do not have.
 */
export function startAskpassServer(handler: AskpassHandler, opts: AskpassOptions): Promise<AskpassBridge> {
  const id = randomBytes(12).toString('hex')
  const token = randomBytes(24).toString('hex')
  const handle =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\leviathan-askpass-${id}`
      : join(tmpdir(), `leviathan-askpass-${id}.sock`)
  const script = join(opts.scriptDir, 'askpass.sh')
  try {
    chmodSync(script, 0o755) // checkouts and installers do not always keep the executable bit
  } catch {
    // read-only location: rely on the mode it was shipped with
  }

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !sameToken(req.headers['x-leviathan-token'], token)) {
      res.writeHead(403).end()
      return
    }
    try {
      const { prompt } = JSON.parse(await readBody(req)) as { prompt?: unknown }
      const answer = await handler(typeof prompt === 'string' ? prompt : '')
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answer }))
    } catch {
      res.writeHead(400).end()
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(handle, () => {
      server.off('error', reject)
      resolve({
        env: {
          GIT_ASKPASS: script,
          SSH_ASKPASS: script,
          // OpenSSH 8.4+: use askpass even without a display or when a tty exists.
          SSH_ASKPASS_REQUIRE: 'force',
          DISPLAY: process.env.DISPLAY || ':0',
          LEVIATHAN_ASKPASS_HANDLE: handle,
          LEVIATHAN_ASKPASS_TOKEN: token,
          LEVIATHAN_ASKPASS_NODE: opts.nodePath,
          LEVIATHAN_ASKPASS_MAIN: join(opts.scriptDir, 'askpass-client.js')
        },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              if (process.platform !== 'win32') rmSync(handle, { force: true })
              done()
            })
          })
      })
    })
  })
}
