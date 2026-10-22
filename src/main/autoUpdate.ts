import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { RELEASE_REPO, updateCheckDue, updateMode, type UpdateState } from '../shared/updates'
import { loadSettings } from './settings'
import { createUpdater, type UpdaterLike } from './updater'

const FIRST_CHECK_MS = 10_000
/** How often the schedule is looked at; `updateCheckDue` decides when a check is actually due. */
const TICK_MS = 60_000

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

/** Sets up update checks against the GitHub releases: shortly after start, every half hour, and on coming back to the app. */
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
  let last: number | null = null
  const tick = (reason: 'timer' | 'focus') => {
    if (!updateCheckDue(Date.now(), last, reason) || !loadSettings().autoUpdate) return
    last = Date.now()
    void updates?.check()
  }
  setTimeout(() => tick('timer'), FIRST_CHECK_MS)
  setInterval(() => tick('timer'), TICK_MS)
  // Coming back to the app is a good moment to notice a release published meanwhile.
  app.on('browser-window-focus', () => tick('focus'))
}

export function getUpdater(): ReturnType<typeof createUpdater> {
  updates ??= createUpdater({ updater: idle, mode: 'off', broadcast: () => {}, openExternal: () => {} })
  return updates
}
