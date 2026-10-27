import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The install module runs in Electron's main process; the downloads here never reach it.
vi.mock('electron', () => ({ net: { fetch: () => Promise.reject(new Error('no network in tests')) } }))

const { installWindowsZip } = await import('../src/main/lfsInstall')

const RELEASE = 'https://api.github.com/repos/git-lfs/git-lfs/releases/latest'
const ZIP = 'git-lfs-windows-amd64-v3.8.1.zip'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** git-lfs's latest release as GitHub serves it, with `sums` as its checksums file. */
function fakeGitHub(sums: string) {
  const asset = (name: string) => ({ name, browser_download_url: `https://github.com/dl/${name}` })
  const bodies: Record<string, string | object> = {
    [RELEASE]: {
      tag_name: 'v3.8.1',
      assets: [asset(ZIP), asset('git-lfs-windows-v3.8.1.exe'), asset('sha256sums.asc')]
    },
    [`https://github.com/dl/${ZIP}`]: 'zip-bytes',
    'https://github.com/dl/sha256sums.asc': sums
  }
  return async (url: string) => {
    const body = bodies[url]
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => JSON.parse(text),
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer
    }
  }
}

let root: string
let installDir: string
const pathBefore = process.env.PATH

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-lfs-install-'))
  installDir = join(root, 'Programs', 'Git LFS')
})

afterEach(() => {
  process.env.PATH = pathBefore
  rmSync(root, { recursive: true, force: true })
})

function deps(sums: string, arch = 'x64') {
  return {
    fetch: fakeGitHub(sums),
    // The zip holds git-lfs.exe in a folder of its version.
    extract: vi.fn(async (_zip: string, dest: string) => {
      mkdirSync(join(dest, 'git-lfs-3.8.1'), { recursive: true })
      writeFileSync(join(dest, 'git-lfs-3.8.1', 'git-lfs.exe'), 'exe')
    }),
    addToUserPath: vi.fn(async () => 'added'),
    installDir,
    arch
  }
}

describe('installWindowsZip', () => {
  it("installs git-lfs.exe from the official zip into the user's folder", async () => {
    const d = deps(`${sha256('zip-bytes')}  ${ZIP}\n`)
    const lines: string[] = []
    expect(await installWindowsZip((line) => lines.push(line), d)).toBe(installDir)
    expect(existsSync(join(installDir, 'git-lfs.exe'))).toBe(true)
    expect(d.addToUserPath).toHaveBeenCalledWith(installDir)
    expect(process.env.PATH?.split(delimiter)[0]).toBe(installDir)
    expect(lines.some((l) => l.includes('3.8.1'))).toBe(true)
  })

  it('stops before extracting when the checksum does not match', async () => {
    const d = deps(`${sha256('other-bytes')}  ${ZIP}\n`)
    await expect(installWindowsZip(() => {}, d)).rejects.toThrow(/checksum/i)
    expect(d.extract).not.toHaveBeenCalled()
    expect(d.addToUserPath).not.toHaveBeenCalled()
    expect(existsSync(installDir) ? readdirSync(installDir) : []).toEqual([])
  })

  it('says when this Windows has no zip to install', async () => {
    const d = deps(`${sha256('zip-bytes')}  ${ZIP}\n`, 'ia32')
    await expect(installWindowsZip(() => {}, d)).rejects.toThrow(/no git-lfs download for this computer/i)
    expect(d.extract).not.toHaveBeenCalled()
  })
})
