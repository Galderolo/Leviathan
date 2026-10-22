import { releasePageUrl, type UpdateMode, type UpdateState } from '../shared/updates'

/** The parts of electron-updater's `autoUpdater` used here (a fake in tests). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: never[]) => void): unknown
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
    updater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
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

  return {
    state: () => state,
    async check(): Promise<UpdateState> {
      // An update on its way or ready to install stays as it is.
      if (mode === 'off' || state.status === 'downloading' || state.status === 'ready') return state
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
