import { app, net, shell } from 'electron'
import electronUpdater from 'electron-updater'
import {
  feedTags,
  newestPublished,
  RELEASES_FEED_URL,
  releaseDownloadUrl,
  updateCheckDue,
  updateFileName,
  updateMode,
  type UpdateState
} from '../shared/updates'
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
  on: () => idle,
  setFeedURL: () => {}
}

let updates: ReturnType<typeof createUpdater> | null = null

/** The newest release whose update file for this platform can be downloaded (a draft's cannot). */
async function locateRelease(): Promise<string | null> {
  const feed = await net.fetch(RELEASES_FEED_URL, { headers: { Accept: 'application/atom+xml' } })
  if (!feed.ok) throw new Error(`GitHub answered ${feed.status}`)
  const file = updateFileName(process.platform)
  return newestPublished(feedTags(await feed.text()), async (tag) => {
    const res = await net.fetch(`${releaseDownloadUrl(tag)}/${file}`, { method: 'HEAD' })
    if (res.status === 404) return false
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    return true
  })
}

/** Sets up update checks against the GitHub releases: shortly after start, every half hour, and on coming back to the app. */
export function initUpdates(broadcast: (state: UpdateState) => void): void {
  const mode = updateMode(process.platform, process.env, app.isPackaged)
  let updater = idle
  // The feed is said before each check (see createUpdater) rather than read from app-update.yml, which
  // portable and unpacked builds lack.
  if (mode !== 'off') updater = electronUpdater.autoUpdater as unknown as UpdaterLike
  updates = createUpdater({
    updater,
    mode,
    broadcast,
    openExternal: (url) => void shell.openExternal(url),
    locate: locateRelease
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
