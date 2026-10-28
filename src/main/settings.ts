import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { writeFileAtomic } from './atomicFile'

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
  writeFileAtomic(file(), JSON.stringify(cache, null, 2))
  return cache
}
