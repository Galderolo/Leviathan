import { describe, expect, it } from 'vitest'
import { settingsFor, withRepoSetting } from '../src/shared/repoSettings'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types'

const settings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

describe('settingsFor', () => {
  it('gives a repository its own values over the general ones', () => {
    const s = settings({
      autoFetchMinutes: 10,
      pullMode: 'ff',
      repoSettings: { '/space': { autoFetchMinutes: 1, pullMode: 'rebase' } }
    })
    expect(settingsFor(s, '/space')).toMatchObject({ autoFetchMinutes: 1, pullMode: 'rebase' })
    expect(settingsFor(s, '/other')).toMatchObject({ autoFetchMinutes: 10, pullMode: 'ff' })
    expect(settingsFor(s, null)).toMatchObject({ autoFetchMinutes: 10, pullMode: 'ff' })
  })

  it('follows the general value of every setting the repository has none of', () => {
    const s = settings({ editor: 'code', repoSettings: { '/space': { autoFetchMinutes: 0 } } })
    expect(settingsFor(s, '/space').editor).toBe('code')
    expect(settingsFor({ ...s, editor: 'subl' }, '/space').editor).toBe('subl')
  })

  it('keeps an empty command of its own: the system default, not the general one', () => {
    const s = settings({ editor: 'code', diffTool: 'meld', repoSettings: { '/space': { editor: '', diffTool: '' } } })
    expect(settingsFor(s, '/space')).toMatchObject({ editor: '', diffTool: '' })
  })

  it('ignores values that are not settings a repository can have, or of the wrong kind', () => {
    const own = { language: 'es', autoFetchMinutes: 'often', pullMode: 'squash', avatars: 1, commitLimit: 500 }
    const s = settings({ repoSettings: { '/space': own as never } })
    const seen = settingsFor(s, '/space')
    expect(seen.language).toBe(DEFAULT_SETTINGS.language)
    expect(seen.autoFetchMinutes).toBe(DEFAULT_SETTINGS.autoFetchMinutes)
    expect(seen.pullMode).toBe(DEFAULT_SETTINGS.pullMode)
    expect(seen.avatars).toBe(DEFAULT_SETTINGS.avatars)
    expect(seen.commitLimit).toBe(500)
  })

  it('reads settings saved before repositories had their own', () => {
    const { repoSettings: _, ...old } = DEFAULT_SETTINGS
    expect(settingsFor(old as Settings, '/space').autoFetchMinutes).toBe(DEFAULT_SETTINGS.autoFetchMinutes)
  })
})

describe('withRepoSetting', () => {
  it('sets a value of its own without touching the rest', () => {
    const map = { '/space': { pullMode: 'rebase' as const }, '/other': { avatars: true } }
    expect(withRepoSetting(map, '/space', 'autoFetchMinutes', 1)).toEqual({
      '/space': { pullMode: 'rebase', autoFetchMinutes: 1 },
      '/other': { avatars: true }
    })
    expect(map['/space']).toEqual({ pullMode: 'rebase' })
  })

  it('goes back to the general value, and forgets a repository left with nothing of its own', () => {
    const map = { '/space': { pullMode: 'rebase' as const, autoFetchMinutes: 1 } }
    const once = withRepoSetting(map, '/space', 'autoFetchMinutes', undefined)
    expect(once).toEqual({ '/space': { pullMode: 'rebase' } })
    expect(withRepoSetting(once, '/space', 'pullMode', undefined)).toEqual({})
    expect(withRepoSetting(undefined, '/space', 'avatars', true)).toEqual({ '/space': { avatars: true } })
  })
})
