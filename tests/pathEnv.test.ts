import { describe, expect, it } from 'vitest'
import { addToPath } from '../src/main/pathEnv'

describe('addToPath', () => {
  it('adds a folder at the end of the PATH once, so nothing already on it is shadowed', () => {
    const win: NodeJS.ProcessEnv = { Path: 'C:\\Windows' }
    expect(addToPath('C:\\X\\', win, 'win32')).toBe(true)
    expect(win.Path).toBe('C:\\Windows;C:\\X\\')
    expect(win.PATH).toBeUndefined()
    expect(addToPath('c:\\x', win, 'win32')).toBe(false)
    expect(win.Path).toBe('C:\\Windows;C:\\X\\')

    // Homebrew's folder after the system's: Apple's git and ssh stay the ones the app runs.
    const unix: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    expect(addToPath('/opt/homebrew/bin', unix, 'darwin')).toBe(true)
    expect(unix.PATH).toBe('/usr/bin:/opt/homebrew/bin')
    expect(addToPath('/opt/homebrew/bin/', unix, 'darwin')).toBe(false)
  })
})
