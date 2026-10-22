import { describe, expect, it } from 'vitest'
import { releasePageUrl, updateCheckDue, updateMode } from '../src/shared/updates'

describe('updateCheckDue', () => {
  const min = 60_000
  it('checks every half hour, and on returning to the window at most every ten minutes', () => {
    const now = 1_000_000_000
    expect(updateCheckDue(now, null, 'timer')).toBe(true)
    expect(updateCheckDue(now, now - 29 * min, 'timer')).toBe(false)
    expect(updateCheckDue(now, now - 30 * min, 'timer')).toBe(true)
    expect(updateCheckDue(now, now - 9 * min, 'focus')).toBe(false)
    expect(updateCheckDue(now, now - 10 * min, 'focus')).toBe(true)
  })
})

describe('updateMode', () => {
  it('installs updates in the Windows installer build and the Linux AppImage', () => {
    expect(updateMode('win32', {}, true)).toBe('install')
    expect(updateMode('linux', { APPIMAGE: '/home/ana/Leviathan.AppImage' }, true)).toBe('install')
  })

  it('only tells about them where the app cannot replace itself', () => {
    // The portable .exe, the .deb package, and macOS builds without code signing.
    expect(updateMode('win32', { PORTABLE_EXECUTABLE_DIR: 'D:/tools' }, true)).toBe('notify')
    expect(updateMode('linux', {}, true)).toBe('notify')
    expect(updateMode('darwin', {}, true)).toBe('notify')
  })

  it('is off while developing', () => {
    expect(updateMode('win32', {}, false)).toBe('off')
  })
})

describe('releasePageUrl', () => {
  it('links to the release of that version', () => {
    expect(releasePageUrl('0.5.0')).toBe('https://github.com/Galderolo/Leviathan/releases/tag/v0.5.0')
  })
})
