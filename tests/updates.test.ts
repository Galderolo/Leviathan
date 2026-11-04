import { describe, expect, it, vi } from 'vitest'
import {
  feedTags,
  newestPublished,
  releaseDownloadUrl,
  releasePageUrl,
  updateCheckDue,
  updateFileName,
  updateMode
} from '../src/shared/updates'

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

describe('feedTags', () => {
  it("lists the tags of GitHub's releases feed, newest first, ignoring links inside the notes", () => {
    const entry = (tag: string) => `  <entry>
    <id>tag:github.com,2008:Repository/1428139425/${tag}</id>
    <link rel="alternate" type="text/html" href="https://github.com/Galderolo/Leviathan/releases/tag/${tag}"/>
    <title>${tag}</title>
    <content type="html">&lt;a href=&quot;https://github.com/Galderolo/Leviathan/releases/tag/v0.1.0&quot;&gt;old&lt;/a&gt;</content>
  </entry>`
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link type="text/html" rel="alternate" href="https://github.com/Galderolo/Leviathan/releases"/>
${entry('v0.23.0')}
${entry('v0.22.1')}
</feed>`
    expect(feedTags(xml)).toEqual(['v0.23.0', 'v0.22.1'])
    expect(feedTags('<feed></feed>')).toEqual([])
  })
})

describe('newestPublished', () => {
  it('skips a tag whose release is not published yet (its installers are still being built)', async () => {
    const published = vi.fn(async (tag: string) => tag !== 'v0.23.0')
    expect(await newestPublished(['v0.23.0', 'v0.22.1', 'v0.22.0'], published)).toBe('v0.22.1')
    expect(published).toHaveBeenCalledTimes(2)
  })

  it('looks only at the newest few, and says when none is published', async () => {
    const published = vi.fn(async () => false)
    expect(await newestPublished(['v6', 'v5', 'v4', 'v3', 'v2', 'v1'], published)).toBeNull()
    expect(published).toHaveBeenCalledTimes(5)
    expect(await newestPublished([], published)).toBeNull()
  })

  it('lets a failed lookup through, so the caller can fall back', async () => {
    const published = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com')
    })
    await expect(newestPublished(['v0.23.0'], published)).rejects.toThrow('ENOTFOUND')
  })
})

describe('update files', () => {
  it('names the file electron-updater reads on each platform, in the folder of that release', () => {
    expect(updateFileName('win32')).toBe('latest.yml')
    expect(updateFileName('darwin')).toBe('latest-mac.yml')
    expect(updateFileName('linux')).toBe('latest-linux.yml')
    expect(releaseDownloadUrl('v0.22.1')).toBe('https://github.com/Galderolo/Leviathan/releases/download/v0.22.1')
  })
})
