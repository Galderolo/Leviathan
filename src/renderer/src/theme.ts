import type { ThemeSetting } from '../../shared/types'

export type Theme = 'dark' | 'light'

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): Theme {
  if (setting === 'system') return prefersDark ? 'dark' : 'light'
  return setting
}
