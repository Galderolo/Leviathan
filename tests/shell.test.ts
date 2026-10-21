import { describe, expect, it } from 'vitest'
import { openAction } from '../src/main/shell'

const plain = { symlink: false, executable: false }

describe('openAction', () => {
  it('opens documents, images and source files that editors and viewers handle', () => {
    for (const file of ['a.txt', 'docs/b.md', 'c.png', 'd.PDF', 'e.json', 'src/f.tsx', 'g.css', 'h.yml']) {
      expect(openAction(file, plain), file).toBe('open')
    }
  })

  it('only reveals files the OS could run', () => {
    const risky = [
      'a.bat',
      'B.CMD',
      'x.exe',
      'y.lnk',
      'z.ps1',
      's.vbs',
      'scripts/t.js',
      'u.msi',
      'k.jar',
      'n.sh',
      'o.command',
      'p.desktop',
      'q.AppImage',
      'r.hta',
      'settings.reg',
      'tool.py',
      'gui.pyw',
      'x.tool',
      'x.terminal',
      'x.workflow',
      'page.html',
      'image.svg'
    ]
    for (const file of risky) expect(openAction(file, plain), file).toBe('reveal')
  })

  it('reveals files without extension or with unknown extensions', () => {
    for (const file of ['gradlew', 'configure', 'Makefile', 'data.xyz']) {
      expect(openAction(file, plain), file).toBe('reveal')
    }
  })

  it('reveals symlinks and executable files whatever their name', () => {
    expect(openAction('notes.txt', { symlink: true, executable: false })).toBe('reveal')
    expect(openAction('readme.md', { symlink: false, executable: true })).toBe('reveal')
  })

  it('reveals names that Windows would normalise (trailing dot or space)', () => {
    expect(openAction('run.bat.', plain)).toBe('reveal')
    expect(openAction('notes.txt ', plain)).toBe('reveal')
    expect(openAction('notes.txt.', plain)).toBe('reveal')
  })
})
