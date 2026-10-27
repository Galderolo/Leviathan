/** How the app can get git-lfs onto this computer. */
export type LfsInstallMethod = 'zip' | 'brew' | 'package' | 'download' | 'command'

export interface LfsInstallOffer {
  method: LfsInstallMethod
  /** For `command`: what to run in a terminal. */
  command?: string
}

export type PackageManager = 'apt-get' | 'dnf' | 'zypper' | 'pacman'

/** An asset of a GitHub release, as the releases API lists it. */
export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/** git-lfs's name for a Windows architecture (`process.arch`), or null when it builds none for it. */
export function windowsArch(arch: string): 'amd64' | 'arm64' | '386' | null {
  if (arch === 'x64') return 'amd64'
  if (arch === 'arm64') return 'arm64'
  if (arch === 'ia32') return '386'
  return null
}

/** The release's Windows zip for this architecture: `git-lfs-windows-<arch>-v<version>.zip`. */
export function pickWindowsZip(assets: ReleaseAsset[], arch: string): ReleaseAsset | null {
  const name = windowsArch(arch)
  if (!name) return null
  const pattern = new RegExp(`^git-lfs-windows-${name}-v[\\d.]+\\.zip$`)
  return assets.find((a) => pattern.test(a.name)) ?? null
}

/** The SHA-256 a release's `sha256sums.asc` gives for `file`, in lowercase; null when it lists no such file. */
export function checksumFor(sums: string, file: string): string | null {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const line = new RegExp(`^([0-9a-fA-F]{64})\\s+\\*?${escaped}\\r?$`, 'm').exec(sums)
  return line ? line[1].toLowerCase() : null
}

const PACKAGE_ARGS: Record<PackageManager, string[]> = {
  'apt-get': ['install', '-y', 'git-lfs'],
  dnf: ['install', '-y', 'git-lfs'],
  zypper: ['--non-interactive', 'install', 'git-lfs'],
  pacman: ['-S', '--noconfirm', 'git-lfs']
}

/** Arguments that install git-lfs with `manager`, without questions. */
export function packageArgs(manager: PackageManager): string[] {
  return PACKAGE_ARGS[manager]
}

/** The command a person types to install git-lfs with `manager`. */
export function sudoCommand(manager: PackageManager): string {
  return `sudo ${manager} ${manager === 'pacman' ? '-S' : 'install'} git-lfs`
}

/**
 * What the app can do here: Windows takes the official zip, macOS needs Homebrew, Linux the package manager with
 * a graphical password prompt (pkexec), else the command to type. Otherwise only the download page is left.
 */
export function installOffer(
  platform: string,
  found: { brew: string | null; pkexec: string | null; manager: PackageManager | null }
): LfsInstallOffer {
  if (platform === 'win32') return { method: 'zip' }
  if (platform === 'darwin') return { method: found.brew ? 'brew' : 'download' }
  if (!found.manager) return { method: 'download' }
  return found.pkexec ? { method: 'package' } : { method: 'command', command: sudoCommand(found.manager) }
}
