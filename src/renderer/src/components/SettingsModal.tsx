import { useEffect, useState } from 'react'
import { openExternal, openWhatsNew, saveSettings } from '../actions'
import { LANGUAGES, useT } from '../i18n'
import { useStore } from '../store'
import type { Settings, ThemeSetting } from '../../../shared/types'
import { AccountsSection } from './AccountsSection'
import { SshKeysSection } from './SshKeysSection'
import { UpdateSettings } from './UpdateNotice'

const REPO_URL = 'https://github.com/Galderolo/Leviathan'

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const versions = useStore((s) => s.versions)
  const t = useT()
  const [language, setLanguage] = useState<Settings['language']>(settings.language)
  const [limit, setLimit] = useState(String(settings.commitLimit))
  const [theme, setTheme] = useState<ThemeSetting>(settings.theme)
  const [autoFetch, setAutoFetch] = useState(String(settings.autoFetchMinutes))
  const [autoUpdate, setAutoUpdate] = useState(settings.autoUpdate)

  useEffect(() => {
    if (open) {
      setLanguage(settings.language)
      setLimit(String(settings.commitLimit))
      setTheme(settings.theme)
      setAutoFetch(String(settings.autoFetchMinutes))
      setAutoUpdate(settings.autoUpdate)
    }
  }, [open, settings])

  // Esc closes Settings wherever the focus is, unless a dialog is open on top of it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useStore.getState().dialog) useStore.setState({ settingsOpen: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const close = () => useStore.setState({ settingsOpen: false })
  const save = async () => {
    const commitLimit = Math.max(100, Math.min(50000, Number(limit) || settings.commitLimit))
    await saveSettings({ language, commitLimit, theme, autoFetchMinutes: Number(autoFetch), autoUpdate })
    close()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="modal wide"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="modal-title">{t('settings.title')}</div>
        <label className="field">
          <span>{t('settings.theme')}</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeSetting)}>
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
            <option value="light">{t('settings.themeLight')}</option>
          </select>
        </label>
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
        <label className="field">
          <span>{t('settings.autoFetch')}</span>
          <select value={autoFetch} onChange={(e) => setAutoFetch(e.target.value)}>
            {[0, 1, 5, 10, 30].map((m) => (
              <option key={m} value={String(m)}>
                {m === 0 ? t('settings.autoFetchOff') : t('settings.autoFetchEvery', { count: m })}
              </option>
            ))}
          </select>
        </label>
        <UpdateSettings auto={autoUpdate} onAuto={setAutoUpdate} />
        <AccountsSection />
        <SshKeysSection />
        <div className="about">
          <div>
            Leviathan {versions.app} · git {versions.git}
          </div>
          <div className="dim">{t('settings.license')}</div>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              openWhatsNew()
            }}
          >
            {t('whatsNew.title')}
          </a>
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
