import { describe, expect, it } from 'vitest'
import { prependToPath } from '../src/main/pathEnv'

describe('prependToPath', () => {
  it('puts a folder first on the PATH once', () => {
    const win: NodeJS.ProcessEnv = { Path: 'C:\\Windows' }
    expect(prependToPath('C:\\X\\', win, 'win32')).toBe(true)
    expect(win.Path).toBe('C:\\X\\;C:\\Windows')
    expect(win.PATH).toBeUndefined()
    expect(prependToPath('c:\\x', win, 'win32')).toBe(false)
    expect(win.Path).toBe('C:\\X\\;C:\\Windows')

    const unix: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    expect(prependToPath('/opt/homebrew/bin', unix, 'darwin')).toBe(true)
    expect(unix.PATH).toBe('/opt/homebrew/bin:/usr/bin')
    expect(prependToPath('/opt/homebrew/bin/', unix, 'darwin')).toBe(false)
  })
})
