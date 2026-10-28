import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Terminals, shellFor, terminalEnv } from '../src/main/terminal'

describe('shellFor', () => {
  const found = { pwsh: true, gitBash: 'C:\\Program Files\\Git\\bin\\bash.exe' }

  it('uses on Windows the shell chosen as the terminal in Settings, PowerShell otherwise', () => {
    expect(shellFor('win32', 'cmd', {}, found)).toEqual({ file: 'cmd.exe', args: [] })
    expect(shellFor('win32', 'pwsh', {}, found)).toEqual({ file: 'pwsh.exe', args: ['-NoLogo'] })
    expect(shellFor('win32', 'git-bash --cd=.', {}, found)).toEqual({ file: found.gitBash, args: ['--login', '-i'] })
    for (const other of ['', 'powershell', 'wt -d .', 'C:\\Tools\\other.exe']) {
      expect(shellFor('win32', other, {}, found)).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    }
  })

  it('falls back to Windows PowerShell when the shell chosen is not there', () => {
    const none = { pwsh: false, gitBash: null }
    expect(shellFor('win32', 'pwsh', {}, none)).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    expect(shellFor('win32', 'git-bash --cd=.', {}, none)).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })

  it("uses the user's shell on macOS (as a login shell, like Terminal) and Linux", () => {
    expect(shellFor('darwin', '', { SHELL: '/opt/homebrew/bin/fish' }, found)).toEqual({
      file: '/opt/homebrew/bin/fish',
      args: ['-l']
    })
    expect(shellFor('darwin', '', {}, found)).toEqual({ file: '/bin/zsh', args: ['-l'] })
    expect(shellFor('linux', '', { SHELL: '/usr/bin/zsh' }, found)).toEqual({ file: '/usr/bin/zsh', args: [] })
    expect(shellFor('linux', '', {}, found)).toEqual({ file: '/bin/bash', args: [] })
  })
})

describe('terminalEnv', () => {
  it("passes the app's environment on, without Electron's own switches", () => {
    const env = terminalEnv({ PATH: '/bin', HOME: '/home/ana', ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/ana', COLORTERM: 'truecolor' })
  })
})

describe('Terminals', () => {
  let terminals: Terminals | null = null
  afterEach(() => terminals?.stopAll())

  /** Consoles running `script` in Node, and what they print, how they end and how often they are killed. */
  function consoles() {
    let output = ''
    const ended: number[] = []
    let kills = 0
    terminals = new Terminals(
      {
        data: (_id, data) => (output += data),
        exit: (_id, code) => ended.push(code)
      },
      async () => {
        const real = await import('node-pty')
        return {
          spawn: (...args: Parameters<typeof real.spawn>) => {
            const pty = real.spawn(...args)
            const kill = pty.kill.bind(pty)
            pty.kill = (signal?: string) => {
              kills++
              kill(signal)
            }
            return pty
          }
        }
      }
    )
    const node = (script: string) => ({ file: process.execPath, args: ['-e', script] })
    return { terminals, node, output: () => output, ended, kills: () => kills }
  }

  // Typed once the program is ready, as a person does: Windows' console drops what comes before the program starts.
  it('runs a program in a console of its own, passes it what is typed and says when it ends', async () => {
    const c = consoles()
    const id = await c.terminals.start(
      c.node(
        "console.log('ready'); process.stdin.on('data', (d) => { process.stdout.write('got ' + d); process.exit(3) })"
      ),
      tmpdir(),
      80,
      24
    )
    await expect.poll(c.output, { timeout: 10_000 }).toContain('ready')
    c.terminals.write(id, 'hello\r')
    await expect.poll(() => c.ended, { timeout: 10_000 }).toEqual([3])
    expect(c.output()).toContain('got hello')
  })

  it('stops a console and the program in it', async () => {
    const c = consoles()
    const id = await c.terminals.start(c.node("console.log('ready'); setInterval(() => {}, 1000)"), tmpdir(), 80, 24)
    await expect.poll(c.output, { timeout: 10_000 }).toContain('ready')
    c.terminals.stop(id)
    await expect.poll(() => c.ended.length, { timeout: 10_000 }).toBe(1)
  })

  // On Windows a console that ends on its own keeps a thread of node-pty's alive, and with it the app, until it is
  // killed.
  it('lets go of a console that ended on its own', async () => {
    const c = consoles()
    await c.terminals.start(c.node("console.log('ready'); setTimeout(() => process.exit(0), 300)"), tmpdir(), 80, 24)
    await expect.poll(() => c.ended, { timeout: 10_000 }).toEqual([0])
    expect(c.kills()).toBe(process.platform === 'win32' ? 1 : 0)
  })

  it('leaves alone a console it does not know', async () => {
    const c = consoles()
    expect(() => {
      c.terminals.write(99, 'x')
      c.terminals.resize(99, 80, 24)
      c.terminals.stop(99)
    }).not.toThrow()
  })
})
