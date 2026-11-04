import { RELEASE_REPO, releaseDownloadUrl, releasePageUrl, type UpdateMode, type UpdateState } from '../shared/updates'

/** The parts of electron-updater's `autoUpdater` used here (a fake in tests). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: never[]) => void): unknown
  setFeedURL(options: Record<string, unknown>): void
}

/**
 * Checks GitHub releases for a newer version and, where this copy of the app
 * can replace itself, downloads and installs it on request; elsewhere the
 * download opens the release page. Every change of state is broadcast.
 */
export function createUpdater(opts: {
  updater: UpdaterLike
  mode: UpdateMode
  broadcast: (state: UpdateState) => void
  openExternal: (url: string) => void
  /** The tag of the newest published release (null: none found). */
  locate?: () => Promise<string | null>
}) {
  const { updater, mode } = opts
  let state: UpdateState = { mode, status: 'idle' }
  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch }
    opts.broadcast(state)
  }
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  // A release is listed as soon as its tag is pushed, while its installers (and latest.yml) take minutes to
  // build and upload: until then there is simply nothing to update to yet.
  const stillPublishing = (err: unknown) => /latest(-\w+)?\.yml[\s\S]*404/.test(message(err))

  if (mode !== 'off') {
    // Download only when asked; releases are published as pre-releases.
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = mode === 'install'
    updater.allowPrerelease = true
    // Looking again leaves an update already found on show, whatever this check runs into.
    updater.on('checking-for-update', () =>
      set(state.status === 'available' ? { error: undefined } : { status: 'checking', error: undefined })
    )
    updater.on('update-available', (info: { version: string }) => set({ status: 'available', version: info.version }))
    updater.on('update-not-available', () => set({ status: 'none' }))
    updater.on('download-progress', (p: { percent: number }) =>
      set({ status: 'downloading', percent: Math.round(p.percent) })
    )
    updater.on('update-downloaded', (info: { version: string }) => set({ status: 'ready', version: info.version }))
    updater.on('error', (err: unknown) => {
      if (stillPublishing(err)) {
        if (state.status === 'checking') set({ status: 'none' })
        return
      }
      // A failed check (or download) must not hide an update already found.
      if (state.status === 'ready') set({ error: message(err) })
      else if (state.version && (state.status === 'available' || state.status === 'downloading')) {
        set({ status: 'available', error: message(err) })
      } else set({ status: 'error', error: message(err) })
    })
  }

  /**
   * electron-updater's GitHub feed takes the newest tag, which is pushed (or created) before its release is
   * published: until then it finds no update file and newer releases already published go unseen. So the
   * check is pointed at the newest published release; when that cannot be looked up, GitHub's feed decides.
   */
  const pointAtNewestPublished = async () => {
    const tag = opts.locate ? await opts.locate().catch(() => null) : null
    updater.setFeedURL(
      tag
        ? // GitHub's downloads do not take several ranges in one request (its own provider says so too).
          { provider: 'generic', url: releaseDownloadUrl(tag), useMultipleRangeRequest: false }
        : { provider: 'github', ...RELEASE_REPO }
    )
  }

  return {
    state: () => state,
    async check(): Promise<UpdateState> {
      // An update on its way or ready to install stays as it is.
      if (mode === 'off' || state.status === 'downloading' || state.status === 'ready') return state
      await pointAtNewestPublished()
      try {
        // electron-updater answers null, with no events, when it has no updater for this install.
        if ((await updater.checkForUpdates()) === null) set({ status: 'unsupported' })
      } catch (err) {
        if (stillPublishing(err)) {
          if (state.status === 'checking') set({ status: 'none' })
        } else if (state.status !== 'available') set({ status: 'error', error: message(err) })
      }
      return state
    },
    async download(): Promise<void> {
      if (state.status !== 'available' || !state.version) return
      if (mode !== 'install') {
        opts.openExternal(releasePageUrl(state.version))
        return
      }
      try {
        await updater.downloadUpdate()
      } catch (err) {
        // Back to "available", so the download can be tried again, and the caller hears about it.
        set({ status: 'available', error: message(err) })
        throw err
      }
    },
    install(): void {
      // Silent, then start the new version: the assisted installer would otherwise show its pages again.
      if (state.status === 'ready') updater.quitAndInstall(true, true)
    }
  }
}
