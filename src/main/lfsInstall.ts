import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { net } from 'electron'
import { checksumFor, pickWindowsZip, type ReleaseAsset } from '../shared/lfsInstall'
import { addToUserPath } from './cli'
import { prependToPath } from './pathEnv'

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
    prependToPath(deps.installDir)
    return deps.installDir
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}
