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
 * Where the editors Settings offers usually live when their installer did not put them on the PATH (JetBrains'
 * installer and Toolbox, Visual Studio, Sublime Text, Notepad++). A `*` stands for one folder, such as a version.
 */
function installPlaces(program: string, env: Env, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? ''
    const pf = env.ProgramFiles ?? 'C:\\Program Files'
    const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    switch (program.toLowerCase()) {
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

async function onPath(program: string, env: Env, platform: NodeJS.Platform, fsx: ProgramFs): Promise<boolean> {
  const windows = platform === 'win32'
  const path = windows ? win32 : posix
  const dirs = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean)
  const exts = windows ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : ['']
  for (const dir of dirs) {
    for (const ext of exts) if (await fsx.exists(path.join(dir, program + ext))) return true
  }
  return false
}

/**
 * The program to run for an editor command: the command itself when the PATH finds it (or it is a path), else
 * where its installer usually puts it (Rider, Visual Studio and others are often not on the PATH), else the
 * command unchanged, so starting it reports it as not found.
 */
export async function findProgram(
  program: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  fsx: ProgramFs = realFs
): Promise<string> {
  if (/[\\/]/.test(program) || (await onPath(program, env, platform, fsx))) return program
  for (const place of installPlaces(program, env, platform)) {
    const [found] = await expand(place, platform === 'win32', fsx)
    if (found) return found
  }
  return program
}
