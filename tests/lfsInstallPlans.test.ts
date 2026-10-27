import { describe, expect, it, vi } from 'vitest'

// The install module runs in Electron's main process; nothing here reaches the network.
vi.mock('electron', () => ({ net: { fetch: () => Promise.reject(new Error('no network in tests')) } }))

const { getLfsInstallOffer, installGitLfs } = await import('../src/main/lfsInstall')

type Result = { exitCode: number; stderr: string }

/** A system with `programs` installed, whose commands end as `answer` says. */
function system(
  platform: NodeJS.Platform,
  programs: Record<string, string>,
  answer = async (): Promise<Result> => ({ exitCode: 0, stderr: '' })
) {
  const calls: [string, string[]][] = []
  const git: string[][] = []
  return {
    calls,
    git,
    deps: {
      platform,
      locate: async (program: string) => programs[program] ?? null,
      run: vi.fn(async (cmd: string, args: string[]) => {
        calls.push([cmd, args])
        return answer()
      }),
      git: async (args: string[]) => {
        git.push(args)
      },
      version: async () => '3.8.1'
    }
  }
}

describe('installGitLfs', () => {
  it('installs with Homebrew, then sets git-lfs up for the user', async () => {
    const mac = system('darwin', { brew: '/opt/homebrew/bin/brew' })
    expect(await getLfsInstallOffer(mac.deps)).toEqual({ method: 'brew' })
    expect(await installGitLfs(() => {}, mac.deps)).toBe('3.8.1')
    expect(mac.calls).toEqual([['/opt/homebrew/bin/brew', ['install', 'git-lfs']]])
    expect(mac.git).toEqual([['lfs', 'install']])
  })

  it('installs with the package manager through pkexec', async () => {
    const linux = system('linux', { pkexec: '/usr/bin/pkexec', 'apt-get': '/usr/bin/apt-get' })
    expect(await getLfsInstallOffer(linux.deps)).toEqual({ method: 'package' })
    expect(await installGitLfs(() => {}, linux.deps)).toBe('3.8.1')
    expect(linux.calls).toEqual([['/usr/bin/pkexec', ['/usr/bin/apt-get', 'install', '-y', 'git-lfs']]])
    expect(linux.git).toEqual([['lfs', 'install']])
  })

  it('turns a dismissed or impossible password prompt into the command to run', async () => {
    for (const exitCode of [126, 127]) {
      const programs = { pkexec: '/usr/bin/pkexec', 'apt-get': '/usr/bin/apt-get' }
      const linux = system('linux', programs, async () => ({
        exitCode,
        stderr: 'Error executing command as another user'
      }))
      await expect(installGitLfs(() => {}, linux.deps)).rejects.toThrow(
        'run "sudo apt-get install git-lfs" in a terminal'
      )
      expect(linux.git).toEqual([])
    }
  })

  it('installs one at a time', async () => {
    let finish: (r: Result) => void = () => {}
    const mac = system('darwin', { brew: '/opt/homebrew/bin/brew' }, () => new Promise<Result>((r) => (finish = r)))
    const first = installGitLfs(() => {}, mac.deps)
    await expect(installGitLfs(() => {}, mac.deps)).rejects.toThrow(/already being installed/)
    await vi.waitFor(() => expect(mac.calls).toHaveLength(1))
    finish({ exitCode: 0, stderr: '' })
    await expect(first).resolves.toBe('3.8.1')
  })
})
