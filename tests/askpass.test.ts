import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startAskpassServer, type AskpassBridge } from '../src/main/askpass/server'
import { NON_INTERACTIVE_ENV, git } from '../src/main/git/runner'

const SCRIPT_DIR = join(__dirname, '..', 'resources', 'askpass')
const client = createRequire(import.meta.url)(join(SCRIPT_DIR, 'askpass-client.js')) as {
  askedPrompt: (argv: string[], cmdLine: string | undefined) => string
  promptFromCmdLine: (line: string) => string | null
  windowsArgs: (line: string) => string[]
}

/** What ssh asks about a host it has never seen: three lines. */
const HOST_PROMPT = [
  "The authenticity of host 'github.com (20.250.119.67)' can't be established.",
  'ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.',
  'Are you sure you want to continue connecting (yes/no/[fingerprint])? '
].join('\n')
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
    const interactivePrompts: string[] = []
    bridge = await startAskpassServer(
      async (prompt, { interactive }) => {
        if (interactive) interactivePrompts.push(prompt)
        return interactive ? 'x' : null
      },
      { scriptDir: SCRIPT_DIR, nodePath: process.execPath }
    )
    await expect(credentialFill({ ...bridge.env, ...NON_INTERACTIVE_ENV })).rejects.toThrow()
    expect(interactivePrompts).toEqual([])
  })

  it('still answers background prompts that stored accounts can answer', async () => {
    bridge = await startAskpassServer(
      async (prompt, { interactive }) => (interactive ? null : /username/i.test(prompt) ? 'ana' : 'T0K'),
      { scriptDir: SCRIPT_DIR, nodePath: process.execPath }
    )
    const { stdout } = await credentialFill({ ...bridge.env, ...NON_INTERACTIVE_ENV })
    expect(stdout).toContain('password=T0K')
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

describe('askpass.cmd on Windows', () => {
  const script = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Leviathan\\resources\\askpass\\askpass.cmd'

  it('reads the whole prompt from the line git for Windows ssh starts cmd with', () => {
    const line = `C:\\WINDOWS\\system32\\cmd.exe /c ${script} "${HOST_PROMPT}"`
    expect(client.promptFromCmdLine(line)).toBe(HOST_PROMPT)
  })

  it("reads the whole prompt from the line Windows' own OpenSSH starts cmd with (quoted once more)", () => {
    const line = `C:\\WINDOWS\\system32\\cmd.exe /c ""${script}" "${HOST_PROMPT}""\r\n`
    expect(client.promptFromCmdLine(line)).toBe(HOST_PROMPT)
  })

  it('reads a script path with spaces, quoted or inside the quoted line', () => {
    const spaced = 'C:\\Program Files\\Git Leviathan\\resources\\askpass\\askpass.cmd'
    expect(client.promptFromCmdLine(`cmd.exe /c "${spaced}" "Password: "`)).toBe('Password: ')
    expect(client.promptFromCmdLine(`cmd.exe /c ""${spaced}" "Password: ""`)).toBe('Password: ')
  })

  it('splits arguments as Windows programs do', () => {
    expect(client.windowsArgs('a "b c" d\\\\"e f"\\"g')).toEqual(['a', 'b c', 'd\\e f"g'])
    expect(client.windowsArgs(`"key 'C:\\Users\\ana/.ssh/id_ed25519':"`)).toEqual([
      "key 'C:\\Users\\ana/.ssh/id_ed25519':"
    ])
  })

  it("keeps the arguments when cmd's line says something else", () => {
    const first = HOST_PROMPT.split('\n')[0]
    expect(client.askedPrompt([first], `cmd.exe /c ${script} "${HOST_PROMPT}"`)).toBe(HOST_PROMPT)
    expect(client.askedPrompt(['Password:'], undefined)).toBe('Password:')
    expect(client.askedPrompt(['Password:'], `cmd.exe /c ${script} "Something else"`)).toBe('Password:')
    expect(client.askedPrompt(['Password:'], 'C:\\WINDOWS\\system32\\cmd.exe')).toBe('Password:')
  })

  /** Runs askpass.cmd as cmd.exe would be started for it, with `args` after `/c` exactly as given. */
  function runCmd(args: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('C:\\Windows\\System32\\cmd.exe', ['/c', args], {
        env: { ...process.env, ...env },
        windowsVerbatimArguments: true
      })
      let stdout = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout }))
    })
  }

  it.runIf(process.platform === 'win32')('hands over all three lines of a new host prompt', async () => {
    const prompts: string[] = []
    bridge = await startAskpassServer(
      async (prompt) => {
        prompts.push(prompt)
        return 'yes'
      },
      { scriptDir: SCRIPT_DIR, nodePath: process.execPath }
    )
    const cmd = join(SCRIPT_DIR, 'askpass.cmd')
    // As git for Windows' ssh starts it, then as Windows' own OpenSSH does (CreateProcess quotes the line once more).
    const plain = await runCmd(`${cmd} "${HOST_PROMPT}"`, bridge.env)
    const wrapped = await runCmd(`""${cmd}" "${HOST_PROMPT}""`, bridge.env)
    expect([plain.code, plain.stdout.trim()]).toEqual([0, 'yes'])
    expect([wrapped.code, wrapped.stdout.trim()]).toEqual([0, 'yes'])
    expect(prompts).toEqual([HOST_PROMPT, HOST_PROMPT])
  })

  it.runIf(process.platform === 'win32')('passes on a "!" in the prompt', async () => {
    const prompts: string[] = []
    bridge = await startAskpassServer(
      async (prompt) => {
        prompts.push(prompt)
        return 'x'
      },
      { scriptDir: SCRIPT_DIR, nodePath: process.execPath }
    )
    await runCmd(`""${join(SCRIPT_DIR, 'askpass.cmd')}" "Enter PIN for key ^1 now!: ""`, bridge.env)
    expect(prompts).toEqual(['Enter PIN for key ^1 now!: '])
  })
})
