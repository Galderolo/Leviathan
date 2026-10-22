import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createUpdater, type UpdaterLike } from '../src/main/updater'
import type { UpdateState } from '../src/shared/updates'

function fakeUpdater() {
  const emitter = new EventEmitter()
  const updater = Object.assign(emitter, {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates: vi.fn(async () => {
      emitter.emit('checking-for-update')
      emitter.emit('update-available', { version: '0.5.0' })
    }),
    downloadUpdate: vi.fn(async () => {
      emitter.emit('download-progress', { percent: 42.4 })
      emitter.emit('update-downloaded', { version: '0.5.0' })
    }),
    quitAndInstall: vi.fn()
  })
  return updater as unknown as UpdaterLike & typeof updater
}

describe('createUpdater', () => {
  it('finds a newer release, downloads it and installs it on request', async () => {
    const updater = fakeUpdater()
    const seen: UpdateState[] = []
    const u = createUpdater({ updater, mode: 'install', broadcast: (s) => seen.push(s), openExternal: vi.fn() })
    expect(updater.autoDownload).toBe(false)
    expect(updater.allowPrerelease).toBe(true)
    await u.check()
    expect(u.state()).toMatchObject({ status: 'available', version: '0.5.0' })
    await u.download()
    expect(seen.map((s) => s.status)).toContain('downloading')
    expect(u.state()).toMatchObject({ status: 'ready', version: '0.5.0' })
    u.install()
    expect(updater.quitAndInstall).toHaveBeenCalled()
  })

  it('opens the release page instead of downloading where the app cannot replace itself', async () => {
    const updater = fakeUpdater()
    const openExternal = vi.fn()
    const u = createUpdater({ updater, mode: 'notify', broadcast: () => {}, openExternal })
    await u.check()
    await u.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://github.com/Galderolo/Leviathan/releases/tag/v0.5.0')
  })

  it('does nothing while developing', async () => {
    const updater = fakeUpdater()
    const u = createUpdater({ updater, mode: 'off', broadcast: () => {}, openExternal: vi.fn() })
    await u.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(u.state().status).toBe('idle')
  })

  it('keeps a downloaded update when it checks again, and reports errors', async () => {
    const updater = fakeUpdater()
    const u = createUpdater({ updater, mode: 'install', broadcast: () => {}, openExternal: vi.fn() })
    await u.check()
    await u.download()
    await u.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(u.state().status).toBe('ready')

    const failing = fakeUpdater()
    failing.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'))
    const v = createUpdater({ updater: failing, mode: 'install', broadcast: () => {}, openExternal: vi.fn() })
    await v.check()
    expect(v.state()).toMatchObject({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' })
  })
})
