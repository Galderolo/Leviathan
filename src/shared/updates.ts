/** How this copy of the app can update itself. */
export type UpdateMode = 'install' | 'notify' | 'off'

/** Where an update stands, as the window shows it. */
export interface UpdateState {
  mode: UpdateMode
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  /** The newer version, once one is found. */
  version?: string
  /** Download progress, 0-100. */
  percent?: number
  error?: string
}

/** Where releases are published (and updates come from). */
export const RELEASE_REPO = { owner: 'Galderolo', repo: 'Leviathan' }

const RELEASES = `https://github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/releases`

/**
 * The Windows installer build and the Linux AppImage replace themselves; the
 * portable .exe, the .deb package and (unsigned) macOS builds can only point to
 * the download page. Nothing happens while developing.
 */
export function updateMode(
  platform: string,
  env: { PORTABLE_EXECUTABLE_DIR?: string; APPIMAGE?: string },
  packaged: boolean
): UpdateMode {
  if (!packaged) return 'off'
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_DIR ? 'notify' : 'install'
  if (platform === 'linux') return env.APPIMAGE ? 'install' : 'notify'
  return 'notify'
}

export function releasePageUrl(version: string): string {
  return `${RELEASES}/tag/v${version}`
}
