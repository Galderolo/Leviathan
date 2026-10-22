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
    // Like electron-updater: events, then a result object (null only when it has no updater).
    checkForUpdates: vi.fn(async (): Promise<unknown> => {
      emitter.emit('checking-for-update')
      emitter.emit('update-available', { version: '0.5.0' })
      return {}
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

describe('createUpdater failures and guards', () => {
  it('reports a failed download and offers the download again', async () => {
    const updater = fakeUpdater()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('ERR_CONNECTION_RESET'))
    const u = createUpdater({ updater, mode: 'install', broadcast: () => {}, openExternal: vi.fn() })
    await u.check()
    await expect(u.download()).rejects.toThrow('ERR_CONNECTION_RESET')
    expect(u.state()).toMatchObject({ status: 'available', version: '0.5.0', error: 'ERR_CONNECTION_RESET' })
  })

  it('keeps an update already found when a later check fails', async () => {
    const updater = fakeUpdater()
    const u = createUpdater({ updater, mode: 'install', broadcast: () => {}, openExternal: vi.fn() })
    await u.check()
    updater.emit('error', new Error('getaddrinfo ENOTFOUND github.com'))
    expect(u.state()).toMatchObject({ status: 'available', version: '0.5.0' })
  })

  it('installs silently and starts the new version', async () => {
    const updater = fakeUpdater()
    const u = createUpdater({ updater, mode: 'install', broadcast: () => {}, openExternal: vi.fn() })
    u.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await u.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    await u.check()
    await u.download()
    u.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('says when this copy cannot look for updates at all', async () => {
    const updater = fakeUpdater()
    updater.checkForUpdates.mockResolvedValueOnce(null)
    const u = createUpdater({ updater, mode: 'install', broadcast: () => {}, openExternal: vi.fn() })
    await u.check()
    expect(u.state().status).toBe('unsupported')
  })
})
