import { useEffect, useState } from 'react'
import { openExternal, saveSettings } from '../actions'
import { LANGUAGES, useT } from '../i18n'
import { useStore } from '../store'
import type { Settings } from '../../../shared/types'

const REPO_URL = 'https://github.com/leviathan-git/leviathan'

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const versions = useStore((s) => s.versions)
  const t = useT()
  const [language, setLanguage] = useState<Settings['language']>(settings.language)
  const [limit, setLimit] = useState(String(settings.commitLimit))

  useEffect(() => {
    if (open) {
      setLanguage(settings.language)
      setLimit(String(settings.commitLimit))
    }
  }, [open, settings])

  if (!open) return null
  const close = () => useStore.setState({ settingsOpen: false })
  const save = async () => {
    const commitLimit = Math.max(100, Math.min(50000, Number(limit) || settings.commitLimit))
    await saveSettings({ language, commitLimit })
    close()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="modal-title">{t('settings.title')}</div>
        <label className="field">
          <span>{t('settings.language')}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as Settings['language'])}>
            <option value="auto">{t('settings.auto')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('settings.commitLimit')}</span>
          <input
            type="number"
            min={100}
            max={50000}
            step={100}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <div className="about">
          <div>
            Leviathan {versions.app} · git {versions.git}
          </div>
          <div className="dim">{t('settings.license')}</div>
          <a
            href={REPO_URL}
            onClick={(e) => {
              e.preventDefault()
              openExternal(REPO_URL)
            }}
          >
            {REPO_URL.replace('https://', '')}
          </a>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
