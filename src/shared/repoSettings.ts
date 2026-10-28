import { DEFAULT_SETTINGS, type PullMode, type RepoSettingKey, type RepoSettings, type Settings } from './types'

export const REPO_SETTING_KEYS: RepoSettingKey[] = [
  'autoFetchMinutes',
  'pullMode',
  'pushAfterCommit',
  'commitLimit',
  'editor',
  'diffTool'
]

const PULL_MODES: PullMode[] = ['ff', 'ff-only', 'rebase']

/** A value a repository can use for `key`: of the setting's kind (settings.json can be edited by hand). */
function usable(key: RepoSettingKey, value: unknown): boolean {
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) return false
  if (key === 'pullMode') return PULL_MODES.includes(value as PullMode)
  return typeof value !== 'number' || (Number.isFinite(value) && value >= 0)
}

/** The values a repository has of its own, those a setting can take. */
export function ownSettings(settings: Settings, repo: string | null | undefined): RepoSettings {
  const saved = repo ? settings.repoSettings?.[repo] : undefined
  const own: Record<string, unknown> = {}
  if (saved) for (const key of REPO_SETTING_KEYS) if (usable(key, saved[key])) own[key] = saved[key]
  return own as RepoSettings
}

/** The settings as a repository sees them: its own values over the general ones. */
export function settingsFor(settings: Settings, repo: string | null | undefined): Settings {
  const own = ownSettings(settings, repo)
  return Object.keys(own).length ? { ...settings, ...own } : settings
}

/**
 * `map` with the repository's own value for `key`, or without it (`undefined`: the general value again). A repository
 * left with no values of its own is dropped.
 */
export function withRepoSetting<K extends RepoSettingKey>(
  map: Record<string, RepoSettings> | undefined,
  repo: string,
  key: K,
  value: Settings[K] | undefined
): Record<string, RepoSettings> {
  const own: RepoSettings = { ...map?.[repo] }
  if (value === undefined) delete own[key]
  else own[key] = value
  const next = { ...map }
  if (Object.keys(own).length) next[repo] = own
  else delete next[repo]
  return next
}
