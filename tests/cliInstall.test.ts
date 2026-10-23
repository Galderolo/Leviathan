import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installCommandLine } from '../src/main/cli'

// A registry key of our own stands in for the user's environment: the real PATH is never touched.
const KEY = 'HKCU:\\Software\\LeviathanTest\\Environment'
const ps = (script: string) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim()
// Read back through base64: PowerShell writes other text in the console code page.
const readPath = () =>
  Buffer.from(
    ps(
      `[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-Item -Path '${KEY}').GetValue('Path', '', 'DoNotExpandEnvironmentNames')))`
    ),
    'base64'
  ).toString('utf16le')

let dir: string

describe.skipIf(process.platform !== 'win32')('installCommandLine (Windows)', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leviathan-cli-'))
    ps(
      `New-Item -Path '${KEY}' -Force | Out-Null; ` +
        `New-ItemProperty -Path '${KEY}' -Name Path -PropertyType ExpandString -Value 'C:\\Tools;C:\\Users\\José\\bin;%USERPROFILE%\\bin' -Force | Out-Null`
    )
  })

  afterEach(() => {
    ps(`Remove-Item -Path 'HKCU:\\Software\\LeviathanTest' -Recurse -Force`)
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes leviathan.cmd and adds its folder to the PATH once, keeping %VARIABLES% unexpanded', async () => {
    const bin = join(dir, 'bín')
    expect(await installCommandLine('C:\\Apps\\Leviathan\\Leviathan.exe', bin, KEY)).toBe('added')
    expect(readFileSync(join(bin, 'leviathan.cmd'), 'utf8')).toBe(
      '@echo off\r\nstart "" "C:\\Apps\\Leviathan\\Leviathan.exe" --cwd="%CD%\\." %*\r\n'
    )
    // Entries with accents survive untouched.
    expect(readPath()).toBe(`C:\\Tools;C:\\Users\\José\\bin;%USERPROFILE%\\bin;${bin}`)
    expect(ps(`(Get-Item -Path '${KEY}').GetValueKind('Path')`)).toBe('ExpandString')

    expect(await installCommandLine('C:\\Apps\\Leviathan\\Leviathan.exe', bin, KEY)).toBe('present')
  })
})
