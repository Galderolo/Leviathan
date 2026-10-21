import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

let cache: Settings | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    cache = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache!
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...loadSettings(), ...patch }
  const target = file()
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
  renameSync(tmp, target)
  return cache
}
