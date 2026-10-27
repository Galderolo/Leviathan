import { promises as fs } from 'node:fs'
import { posix, win32 } from 'node:path'

/** The file system calls the search needs (a fake one in tests). */
export interface ProgramFs {
  exists(path: string): Promise<boolean>
  /** Names in a folder; empty when it does not exist. */
  list(dir: string): Promise<string[]>
}

const realFs: ProgramFs = {
  exists: (path) =>
    fs.access(path).then(
      () => true,
      () => false
    ),
  list: (dir) => fs.readdir(dir).catch(() => [])
}

type Env = Record<string, string | undefined>

/**
 * Where the editors and terminals Settings offers usually live when their installer did not put them on the PATH
 * (JetBrains' installer and Toolbox, Visual Studio, Sublime Text, Notepad++, Git Bash…). A `*` stands for one
 * folder, such as a version.
 */
function installPlaces(program: string, env: Env, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? ''
    const pf = env.ProgramFiles ?? 'C:\\Program Files'
    const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    switch (program.toLowerCase().replace(/\.exe$/, '')) {
      case 'git-bash':
        // Git for Windows' own folder (git.exe itself is in its cmd folder, on the PATH).
        return [`${pf}\\Git\\git-bash.exe`, `${local}\\Programs\\Git\\git-bash.exe`]
      case 'pwsh':
        return [`${pf}\\PowerShell\\*\\pwsh.exe`]
      case 'wt':
        // An app execution alias, in a folder that is normally on the PATH.
        return [`${local}\\Microsoft\\WindowsApps\\wt.exe`]
      case 'code':
        return [`${local}\\Programs\\Microsoft VS Code\\bin\\code.cmd`, `${pf}\\Microsoft VS Code\\bin\\code.cmd`]
      case 'cursor':
        return [`${local}\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd`]
      case 'rider':
        return [
          `${local}\\JetBrains\\Toolbox\\scripts\\rider.cmd`,
          `${local}\\Programs\\Rider\\bin\\rider64.exe`,
          `${pf}\\JetBrains\\JetBrains Rider *\\bin\\rider64.exe`,
          `${local}\\JetBrains\\Toolbox\\apps\\Rider\\*\\*\\bin\\rider64.exe`
        ]
      case 'devenv':
        return [
          `${pf}\\Microsoft Visual Studio\\*\\*\\Common7\\IDE\\devenv.exe`,
          `${pf86}\\Microsoft Visual Studio\\*\\*\\Common7\\IDE\\devenv.exe`
        ]
      case 'subl':
        return [`${pf}\\Sublime Text\\subl.exe`, `${pf}\\Sublime Text 3\\subl.exe`]
      case 'notepad++':
        return [`${pf}\\Notepad++\\notepad++.exe`, `${pf86}\\Notepad++\\notepad++.exe`]
      case 'git-lfs':
        // Its installer (and the app's own install) for the user only, or for the whole machine.
        return [`${local}\\Programs\\Git LFS\\git-lfs.exe`, `${pf}\\Git LFS\\git-lfs.exe`]
      default:
        return []
    }
  }
  const home = env.HOME ?? ''
  if (platform === 'darwin') {
    const app = (bundle: string, inner: string) => [
      `/Applications/${bundle}/${inner}`,
      `${home}/Applications/${bundle}/${inner}`
    ]
    switch (program) {
      case 'code':
        return app('Visual Studio Code.app', 'Contents/Resources/app/bin/code')
      case 'cursor':
        return app('Cursor.app', 'Contents/Resources/app/bin/cursor')
      case 'rider':
        return app('Rider.app', 'Contents/MacOS/rider')
      case 'subl':
        return app('Sublime Text.app', 'Contents/SharedSupport/bin/subl')
      // Homebrew (Apple silicon, then Intel): not on the PATH of an app opened from the Finder.
      case 'git-lfs':
      case 'brew':
        return [`/opt/homebrew/bin/${program}`, `/usr/local/bin/${program}`]
      default:
        return []
    }
  }
  return program === 'rider' ? [`${home}/.local/share/JetBrains/Toolbox/scripts/rider`, '/snap/bin/rider'] : []
}

/** The existing paths a place with `*` folders stands for, the newest name first (versions sort high). */
async function expand(place: string, windows: boolean, fsx: ProgramFs): Promise<string[]> {
  const sep = windows ? '\\' : '/'
  const parts = place.split(sep)
  const star = parts.findIndex((p) => p.includes('*'))
  if (star < 0) return (await fsx.exists(place)) ? [place] : []
  const parent = parts.slice(0, star).join(sep)
  const match = new RegExp(
    `^${parts[star].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    windows ? 'i' : ''
  )
  const names = (await fsx.list(parent)).filter((n) => match.test(n))
  names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const found: string[] = []
  for (const name of names)
    found.push(...(await expand([parent, name, ...parts.slice(star + 1)].join(sep), windows, fsx)))
  return found
}

/** Where the PATH has a program (its full path), trying Windows' executable extensions; null when it has none. */
async function onPath(program: string, env: Env, platform: NodeJS.Platform, fsx: ProgramFs): Promise<string | null> {
  const windows = platform === 'win32'
  const path = windows ? win32 : posix
  const dirs = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean)
  const exts = windows ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, program + ext.toLowerCase())
      if (await fsx.exists(full)) return full
    }
  }
  return null
}

/**
 * Where a program is, as a full path: on the PATH (or the path it already is, when it exists), else where its
 * installer usually puts it (Rider, Visual Studio, Git Bash and others are often not on the PATH); null when
 * nowhere. Never the working folder: started by its full path, a program is not looked for there either.
 */
export async function locateProgram(
  program: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  fsx: ProgramFs = realFs
): Promise<string | null> {
  if (/[\\/]/.test(program)) return (await fsx.exists(program)) ? program : null
  const found = await onPath(program, env, platform, fsx)
  if (found) return found
  for (const place of installPlaces(program, env, platform)) {
    const [found] = await expand(place, platform === 'win32', fsx)
    if (found) return found
  }
  return null
}

/**
 * The program to run for an editor command: where `locateProgram` finds it, else the command unchanged, so
 * starting it reports it as not found.
 */
export async function findProgram(
  program: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  fsx: ProgramFs = realFs
): Promise<string> {
  return (await locateProgram(program, env, platform, fsx)) ?? program
}
