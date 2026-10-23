import { describe, expect, it } from 'vitest'
import { findProgram, locateProgram, type ProgramFs } from '../src/main/programs'

/** A file system holding exactly `files` (Windows paths compare without case, like NTFS). */
function fakeFs(files: string[], windows = true): ProgramFs {
  const norm = (p: string) => (windows ? p.toLowerCase().replace(/\//g, '\\') : p)
  const all = files.map(norm)
  const sep = windows ? '\\' : '/'
  return {
    exists: async (path) => all.includes(norm(path)),
    list: async (dir) => {
      const prefix = norm(dir).replace(/[\\/]+$/, '') + sep
      const names = new Set<string>()
      for (const [i, f] of all.entries()) {
        if (f.startsWith(prefix)) names.add(files[i].slice(prefix.length).split(/[\\/]/)[0])
      }
      return [...names]
    }
  }
}

const winEnv = {
  PATH: 'C:\\Windows\\system32;C:\\Tools',
  PATHEXT: '.COM;.EXE;.BAT;.CMD',
  LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)'
}

describe('findProgram', () => {
  it('keeps a command the PATH already finds', async () => {
    const fs = fakeFs([
      'C:\\Tools\\rider.cmd',
      'C:\\Program Files\\JetBrains\\JetBrains Rider 2025.2\\bin\\rider64.exe'
    ])
    expect(await findProgram('rider', winEnv, 'win32', fs)).toBe('rider')
  })

  it('finds Rider where JetBrains installs it, the newest version first', async () => {
    const fs = fakeFs([
      'C:\\Program Files\\JetBrains\\JetBrains Rider 2024.3\\bin\\rider64.exe',
      'C:\\Program Files\\JetBrains\\JetBrains Rider 2025.2\\bin\\rider64.exe'
    ])
    expect(await findProgram('rider', winEnv, 'win32', fs)).toBe(
      'C:\\Program Files\\JetBrains\\JetBrains Rider 2025.2\\bin\\rider64.exe'
    )
    // The Toolbox app.
    const toolbox = fakeFs(['C:\\Users\\ana\\AppData\\Local\\Programs\\Rider\\bin\\rider64.exe'])
    expect(await findProgram('rider', winEnv, 'win32', toolbox)).toBe(
      'C:\\Users\\ana\\AppData\\Local\\Programs\\Rider\\bin\\rider64.exe'
    )
  })

  it('finds the other preset editors where their installers put them', async () => {
    const fs = fakeFs([
      'C:\\Users\\ana\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe',
      'C:\\Program Files\\Sublime Text\\subl.exe',
      'C:\\Program Files (x86)\\Notepad++\\notepad++.exe'
    ])
    expect(await findProgram('code', winEnv, 'win32', fs)).toBe(
      'C:\\Users\\ana\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd'
    )
    expect(await findProgram('devenv', winEnv, 'win32', fs)).toBe(
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe'
    )
    expect(await findProgram('subl', winEnv, 'win32', fs)).toBe('C:\\Program Files\\Sublime Text\\subl.exe')
    expect(await findProgram('notepad++', winEnv, 'win32', fs)).toBe(
      'C:\\Program Files (x86)\\Notepad++\\notepad++.exe'
    )
  })

  it('finds an app bundle on macOS', async () => {
    const fs = fakeFs(['/Applications/Rider.app/Contents/MacOS/rider'], false)
    expect(await findProgram('rider', { PATH: '/usr/bin', HOME: '/Users/ana' }, 'darwin', fs)).toBe(
      '/Applications/Rider.app/Contents/MacOS/rider'
    )
  })

  it('leaves alone a path, an unknown program, or one installed nowhere known', async () => {
    const fs = fakeFs([])
    expect(await findProgram('D:\\Apps\\editor.exe', winEnv, 'win32', fs)).toBe('D:\\Apps\\editor.exe')
    expect(await findProgram('myeditor', winEnv, 'win32', fs)).toBe('myeditor')
    expect(await findProgram('rider', winEnv, 'win32', fs)).toBe('rider')
  })
})

describe('locateProgram', () => {
  it('finds the terminals Settings offers where their installers put them', async () => {
    const fs = fakeFs([
      'C:\\Program Files\\Git\\git-bash.exe',
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Users\\ana\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
    ])
    expect(await locateProgram('git-bash', winEnv, 'win32', fs)).toBe('C:\\Program Files\\Git\\git-bash.exe')
    expect(await locateProgram('pwsh', winEnv, 'win32', fs)).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    expect(await locateProgram('wt', winEnv, 'win32', fs)).toBe(
      'C:\\Users\\ana\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
    )
    // Git for Windows installed for the user only.
    const user = fakeFs(['C:\\Users\\ana\\AppData\\Local\\Programs\\Git\\git-bash.exe'])
    expect(await locateProgram('git-bash', winEnv, 'win32', user)).toBe(
      'C:\\Users\\ana\\AppData\\Local\\Programs\\Git\\git-bash.exe'
    )
  })

  it('says when a program is nowhere, a path included', async () => {
    const fs = fakeFs(['C:\\Windows\\system32\\cmd.exe'])
    expect(await locateProgram('cmd', winEnv, 'win32', fs)).toBe('cmd')
    expect(await locateProgram('git-bash', winEnv, 'win32', fs)).toBeNull()
    expect(await locateProgram('D:\\Apps\\term.exe', winEnv, 'win32', fs)).toBeNull()
  })
})
