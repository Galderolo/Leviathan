import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startAskpassServer, type AskpassBridge } from '../src/main/askpass/server'
import { NON_INTERACTIVE_ENV, git } from '../src/main/git/runner'

const SCRIPT_DIR = join(__dirname, '..', 'resources', 'askpass')
let bridge: AskpassBridge | null = null

afterEach(async () => {
  await bridge?.close()
  bridge = null
})

/** Asks git for credentials without any helper, so only the askpass bridge can answer. */
function credentialFill(env: Record<string, string>) {
  return git(['-c', 'credential.helper=', 'credential', 'fill'], {
    cwd: __dirname,
    env,
    input: 'protocol=https\nhost=example.com\n\n'
  })
}

describe('askpass bridge', () => {
  it('answers git credential prompts through the handler', async () => {
    const prompts: string[] = []
    bridge = await startAskpassServer(
      async (prompt) => {
        prompts.push(prompt)
        return /username/i.test(prompt) ? 'ana' : 's3cret'
      },
      { scriptDir: SCRIPT_DIR, nodePath: process.execPath }
    )
    const { stdout } = await credentialFill(bridge.env)
    expect(stdout).toContain('username=ana')
    expect(stdout).toContain('password=s3cret')
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toMatch(/Username for 'https:\/\/example\.com'/)
  })

  it('fails the prompt when the user cancels', async () => {
    bridge = await startAskpassServer(async () => null, { scriptDir: SCRIPT_DIR, nodePath: process.execPath })
    await expect(credentialFill(bridge.env)).rejects.toThrow()
  })

  it('never prompts during background operations', async () => {
    const prompts: string[] = []
    bridge = await startAskpassServer(
      async (prompt) => {
        prompts.push(prompt)
        return 'x'
      },
      { scriptDir: SCRIPT_DIR, nodePath: process.execPath }
    )
    await expect(credentialFill({ ...bridge.env, ...NON_INTERACTIVE_ENV })).rejects.toThrow()
    expect(prompts).toEqual([])
  })

  it('rejects requests without the token', async () => {
    bridge = await startAskpassServer(async () => 'x', { scriptDir: SCRIPT_DIR, nodePath: process.execPath })
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ socketPath: bridge!.env.LEVIATHAN_ASKPASS_HANDLE, method: 'POST', path: '/' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end(JSON.stringify({ prompt: 'Password:' }))
    })
    expect(status).toBe(403)
  })
})
