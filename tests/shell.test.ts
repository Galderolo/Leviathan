import { describe, expect, it } from 'vitest'
import { isExecutableFile } from '../src/main/shell'

describe('isExecutableFile', () => {
  it('flags files the OS would run instead of open', () => {
    const risky = [
      'a.bat',
      'B.CMD',
      'x.exe',
      'y.lnk',
      'z.ps1',
      's.vbs',
      'scripts/t.js',
      'u.msi',
      'v.scr',
      'w.com',
      'k.jar',
      'm.app',
      'n.sh',
      'o.command',
      'p.desktop',
      'q.AppImage',
      'r.hta',
      'settings.reg'
    ]
    for (const file of risky) expect(isExecutableFile(file), file).toBe(true)
  })

  it('lets documents and images open normally', () => {
    for (const file of ['a.txt', 'docs/b.md', 'c.png', 'Makefile', 'archive.tar.gz']) {
      expect(isExecutableFile(file), file).toBe(false)
    }
  })
})
