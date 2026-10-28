import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { git } from '../src/main/git/runner'
import { commandProcessor, keepProgramSearchOutOfWorkingFolder } from '../src/main/programSearch'

describe('starting programs', () => {
  it("starts cmd by its full path, Windows' own", () => {
    expect(commandProcessor({ ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe' })).toBe('C:\\WINDOWS\\system32\\cmd.exe')
    expect(commandProcessor({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\cmd.exe')
  })

  it('asks Windows to leave the working folder out of the search for a program, and changes nothing elsewhere', () => {
    const windows: Record<string, string | undefined> = {}
    keepProgramSearchOutOfWorkingFolder(windows, 'win32')
    expect(windows).toEqual({ NoDefaultCurrentDirectoryInExePath: '1' })
    const linux: Record<string, string | undefined> = {}
    keepProgramSearchOutOfWorkingFolder(linux, 'linux')
    expect(linux).toEqual({})
  })

  // A cloned repository is the working folder of every git command: a git.exe committed at its root must never be
  // what runs. Windows looks in the working folder before the PATH unless told not to.
  it.runIf(process.platform === 'win32')('never runs a git.exe from the repository folder', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'leviathan-planted-'))
    // A harmless program standing in for a hostile one: if it runs, git's answer is not there.
    copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), join(repo, 'git.exe'))
    const saved = process.env.NoDefaultCurrentDirectoryInExePath
    delete process.env.NoDefaultCurrentDirectoryInExePath
    try {
      keepProgramSearchOutOfWorkingFolder()
      const { stdout } = await git(['--version'], { cwd: repo, okCodes: [0, 1, 2, 128] })
      expect(stdout).toMatch(/^git version/)
    } finally {
      if (saved === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath
      else process.env.NoDefaultCurrentDirectoryInExePath = saved
      rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })
})
