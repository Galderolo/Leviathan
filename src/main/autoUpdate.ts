import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { RELEASE_REPO, updateMode, type UpdateState } from '../shared/updates'
import { loadSettings } from './settings'
import { createUpdater, type UpdaterLike } from './updater'

const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

// Stands in for electron-updater while developing, so nothing is checked or set up.
const idle: UpdaterLike = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowPrerelease: false,
  checkForUpdates: async () => null,
  downloadUpdate: async () => null,
  quitAndInstall: () => {},
  on: () => idle
}

let updates: ReturnType<typeof createUpdater> | null = null

/** Sets up update checks against the GitHub releases: shortly after start, then every few hours. */
export function initUpdates(broadcast: (state: UpdateState) => void): void {
  const mode = updateMode(process.platform, process.env, app.isPackaged)
  let updater = idle
  if (mode !== 'off') {
    // Said here rather than read from app-update.yml, which portable and unpacked builds lack.
    electronUpdater.autoUpdater.setFeedURL({ provider: 'github', ...RELEASE_REPO })
    updater = electronUpdater.autoUpdater as unknown as UpdaterLike
  }
  updates = createUpdater({
    updater,
    mode,
    broadcast,
    openExternal: (url) => void shell.openExternal(url)
  })
  if (mode === 'off') return
  const tick = () => {
    if (loadSettings().autoUpdate) void updates?.check()
  }
  setTimeout(tick, FIRST_CHECK_MS)
  setInterval(tick, CHECK_EVERY_MS)
}

export function getUpdater(): ReturnType<typeof createUpdater> {
  updates ??= createUpdater({ updater: idle, mode: 'off', broadcast: () => {}, openExternal: () => {} })
  return updates
}
