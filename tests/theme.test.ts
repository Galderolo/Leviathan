import { describe, expect, it } from 'vitest'
import { resolveTheme } from '../src/renderer/src/theme'

describe('resolveTheme', () => {
  it('uses the explicit choice', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the operating system when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
