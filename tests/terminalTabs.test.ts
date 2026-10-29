import { describe, expect, it } from 'vitest'
import { opensLink, shellLabel, terminalFontSize } from '../src/renderer/src/terminalTabs'

describe('the terminal tabs', () => {
  it('names each console after its shell', () => {
    expect(shellLabel('powershell.exe')).toBe('powershell')
    expect(shellLabel('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('bash')
    expect(shellLabel('/bin/zsh')).toBe('zsh')
    expect(shellLabel('')).toBe('shell')
  })

  it('opens a link with Ctrl+click, ⌘+click on macOS: a plain click selects text', () => {
    expect(opensLink({ ctrlKey: true, metaKey: false }, false)).toBe(true)
    expect(opensLink({ ctrlKey: false, metaKey: false }, false)).toBe(false)
    expect(opensLink({ ctrlKey: false, metaKey: true }, true)).toBe(true)
    expect(opensLink({ ctrlKey: true, metaKey: false }, true)).toBe(false)
  })

  it('keeps the font size within what reads well', () => {
    expect(terminalFontSize(15)).toBe(15)
    expect(terminalFontSize(4)).toBe(9)
    expect(terminalFontSize(80)).toBe(24)
    expect(terminalFontSize(Number.NaN)).toBe(13)
  })
})
