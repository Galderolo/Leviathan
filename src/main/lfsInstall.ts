import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { net } from 'electron'
import {
  checksumFor,
  installOffer,
  packageArgs,
  pickWindowsZip,
  sudoCommand,
  type LfsInstallOffer,
  type PackageManager,
  type ReleaseAsset
} from '../shared/lfsInstall'
import { addToUserPath } from './cli'
import { lfsVersion } from './git/lfs'
import { git } from './git/runner'
import { addToPath } from './pathEnv'
import { locateProgram } from './programs'

const LATEST_RELEASE = 'https://api.github.com/repos/git-lfs/git-lfs/releases/latest'

interface Fetched {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface InstallDeps {
  fetch: (url: string) => Promise<Fetched>
  extract: (zip: string, dest: string) => Promise<void>
  addToUserPath: (dir: string) => Promise<unknown>
  installDir: string
  arch: string
}

/** The real ones: Electron's fetch (it follows the system's proxy), Windows' own tar (it reads zips). */
export function windowsDeps(): InstallDeps {
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return {
    fetch: (url) => net.fetch(url, { headers: { 'User-Agent': 'Leviathan' } }),
    extract: (zip, dest) =>
      new Promise((resolve, reject) =>
        execFile(tar, ['-xf', zip, '-C', dest], { windowsHide: true }, (err, _out, stderr) =>
          err ? reject(new Error(stderr.trim() || err.message)) : resolve()
        )
      ),
    addToUserPath: (dir) => addToUserPath(dir),
    installDir: join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git LFS'),
    arch: process.arch
  }
}

async function download(deps: InstallDeps, url: string): Promise<Fetched> {
  const res = await deps.fetch(url)
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`)
  return res
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name) return full
    if (entry.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    }
  }
  return null
}

/**
 * Windows: git-lfs.exe from the latest official zip, checked against the release's checksums, into the user's own
 * programs folder, which goes on the user's PATH and this process's. The official installer is not used: it refuses,
 * when run without questions, a git outside Program Files (a per-user Git for Windows, Scoop).
 */
export async function installWindowsZip(onProgress: (line: string) => void, deps: InstallDeps): Promise<string> {
  const release = (await (await download(deps, LATEST_RELEASE)).json()) as {
    tag_name?: string
    assets?: ReleaseAsset[]
  }
  const assets = release.assets ?? []
  const zip = pickWindowsZip(assets, deps.arch)
  const sums = assets.find((a) => a.name === 'sha256sums.asc')
  if (!zip || !sums) throw new Error('There is no git-lfs download for this computer: get it from git-lfs.com.')
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  const temp = await fs.mkdtemp(join(tmpdir(), 'leviathan-git-lfs-'))
  try {
    onProgress(`Downloading git-lfs ${version}…`)
    const [bytes, list] = await Promise.all([
      download(deps, zip.browser_download_url).then((r) => r.arrayBuffer()),
      download(deps, sums.browser_download_url).then((r) => r.text())
    ])
    const data = Buffer.from(bytes)
    if (checksumFor(list, zip.name) !== createHash('sha256').update(data).digest('hex')) {
      throw new Error(`The download of ${zip.name} does not match its checksum: nothing was installed.`)
    }
    onProgress(`Installing git-lfs ${version}…`)
    const file = join(temp, zip.name)
    const out = join(temp, 'out')
    await fs.writeFile(file, data)
    await fs.mkdir(out)
    await deps.extract(file, out)
    const exe = await findFile(out, 'git-lfs.exe')
    if (!exe) throw new Error(`${zip.name} has no git-lfs.exe inside`)
    await fs.mkdir(deps.installDir, { recursive: true })
    await fs.copyFile(exe, join(deps.installDir, 'git-lfs.exe'))
    await deps.addToUserPath(deps.installDir)
    addToPath(deps.installDir)
    return deps.installDir
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

export interface PlatformDeps {
  platform: NodeJS.Platform
  locate: (program: string) => Promise<string | null>
  /** Runs a program, its output lines as progress. */
  run: (
    cmd: string,
    args: string[],
    onProgress: (line: string) => void
  ) => Promise<{ exitCode: number; stderr: string }>
  git: (args: string[]) => Promise<void>
  version: () => Promise<string | null>
  windows: () => InstallDeps
}

function realDeps(): PlatformDeps {
  return {
    platform: process.platform,
    locate: (program) => locateProgram(program),
    run: (cmd, args, onProgress) =>
      new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { windowsHide: true })
        let stderr = ''
        const lines = (chunk: Buffer) =>
          chunk
            .toString()
            .split(/\r?\n|\r/)
            .filter(Boolean)
            .forEach(onProgress)
        child.stdout.on('data', lines)
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
          lines(chunk)
        })
        child.on('error', reject)
        child.on('close', (code) => resolve({ exitCode: code ?? 1, stderr }))
      }),
    git: async (args) => {
      await git(args, { cwd: homedir() })
    },
    version: lfsVersion,
    windows: windowsDeps
  }
}

const MANAGERS: PackageManager[] = ['apt-get', 'dnf', 'zypper', 'pacman']

async function findManager(deps: PlatformDeps): Promise<{ name: PackageManager; path: string } | null> {
  for (const name of MANAGERS) {
    const path = await deps.locate(name)
    if (path) return { name, path }
  }
  return null
}

/** What the app can do to get git-lfs onto this computer. */
export async function getLfsInstallOffer(deps: Partial<PlatformDeps> = {}): Promise<LfsInstallOffer> {
  const d = { ...realDeps(), ...deps }
  if (d.platform === 'win32') return installOffer(d.platform, { brew: null, pkexec: null, manager: null })
  if (d.platform === 'darwin')
    return installOffer(d.platform, { brew: await d.locate('brew'), pkexec: null, manager: null })
  const manager = await findManager(d)
  return installOffer(d.platform, { brew: null, pkexec: await d.locate('pkexec'), manager: manager?.name ?? null })
}

let installing = false

/** Installs git-lfs the way this computer allows, sets it up for the user, and gives its version. One at a time. */
export async function installGitLfs(
  onProgress: (line: string) => void,
  deps: Partial<PlatformDeps> = {}
): Promise<string> {
  if (installing) throw new Error('git-lfs is already being installed')
  installing = true
  try {
    const d = { ...realDeps(), ...deps }
    const offer = await getLfsInstallOffer(d)
    if (offer.method === 'zip') {
      await installWindowsZip(onProgress, d.windows())
    } else if (offer.method === 'brew') {
      const brew = (await d.locate('brew'))!
      onProgress('brew install git-lfs')
      const { exitCode, stderr } = await d.run(brew, ['install', 'git-lfs'], onProgress)
      if (exitCode !== 0) throw new Error(`Homebrew could not install git-lfs: ${lastLine(stderr)}`)
      addToPath(dirname(brew))
    } else if (offer.method === 'package') {
      const manager = (await findManager(d))!
      const pkexec = (await d.locate('pkexec'))!
      onProgress(sudoCommand(manager.name))
      const { exitCode, stderr } = await d.run(pkexec, [manager.path, ...packageArgs(manager.name)], onProgress)
      // pkexec: 126 when the password prompt is dismissed, 127 when there is none to show.
      if (exitCode === 126 || exitCode === 127) {
        throw new Error(`Could not ask for your password: run "${sudoCommand(manager.name)}" in a terminal.`)
      }
      if (exitCode !== 0) throw new Error(`${manager.name} could not install git-lfs: ${lastLine(stderr)}`)
    } else {
      throw new Error('This system needs git-lfs installed by hand')
    }
    // Only the user's git configuration: no hooks into whatever repository the folder git runs in may be.
    await d.git(['lfs', 'install', '--skip-repo'])
    const version = await d.version()
    if (!version) throw new Error('git-lfs was installed but cannot be found')
    return version
  } finally {
    installing = false
  }
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).pop() || 'it gave no reason'
}
