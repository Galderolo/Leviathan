import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { openExternal, openWhatsNew, saveSettings, setAvatars } from '../actions'
import { LANGUAGES, useT, type TKey } from '../i18n'
import { SHORTCUT_GROUPS, keysLabel } from '../shortcuts'
import { useStore, type SettingsSection } from '../store'
import { cx } from '../utils'
import type { Settings, ThemeSetting } from '../../../shared/types'
import { AccountsSection } from './AccountsSection'
import { ExternalToolsSettings } from './ExternalToolsSettings'
import { RepoSettingsSection } from './RepoSettingsSection'
import { SshKeysSection } from './SshKeysSection'
import { UpdateSettings } from './UpdateNotice'

const REPO_URL = 'https://github.com/Galderolo/Leviathan'

const SECTIONS: { id: SettingsSection; label: TKey }[] = [
  { id: 'general', label: 'settings.general' },
  { id: 'repo', label: 'settings.repo' },
  { id: 'tools', label: 'tools.title' },
  { id: 'accounts', label: 'accounts.title' },
  { id: 'ssh', label: 'ssh.title' },
  { id: 'updates', label: 'update.title' },
  { id: 'shortcuts', label: 'keys.title' },
  { id: 'about', label: 'settings.about' }
]

/** Settings, by section. Every change is saved at once. */
export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const t = useT()
  const section = useStore((s) => s.settingsSection)

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
  const show = (id: SettingsSection) => useStore.setState({ settingsSection: id })

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings" role="dialog" aria-label={t('settings.title')}>
        <div className="settings-header">
          <div className="modal-title">{t('settings.title')}</div>
          <button type="button" className="icon-btn" title={t('common.close')} onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={cx('settings-nav-item', section === s.id && 'active')}
                onClick={() => show(s.id)}
              >
                {t(s.label)}
              </button>
            ))}
          </nav>
          {/* Every section stays mounted (hidden when not shown): a sign-in or a form in progress survives a switch. */}
          <div className="settings-body" hidden={section !== 'general'}>
            <GeneralSettings />
          </div>
          <div className="settings-body" hidden={section !== 'repo'}>
            <RepoSettingsSection />
          </div>
          <div className="settings-body" hidden={section !== 'tools'}>
            <ExternalToolsSettings />
          </div>
          <div className="settings-body" hidden={section !== 'accounts'}>
            <AccountsSection />
          </div>
          <div className="settings-body" hidden={section !== 'ssh'}>
            <SshKeysSection />
          </div>
          <div className="settings-body" hidden={section !== 'updates'}>
            <AutoUpdateSettings />
          </div>
          <div className="settings-body" hidden={section !== 'shortcuts'}>
            <ShortcutsList />
          </div>
          <div className="settings-body" hidden={section !== 'about'}>
            <About />
          </div>
        </div>
      </div>
    </div>
  )
}

function GeneralSettings() {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const [limit, setLimit] = useState(String(settings.commitLimit))
  const saveLimit = () => {
    const commitLimit = Math.max(100, Math.min(50000, Number(limit) || settings.commitLimit))
    setLimit(String(commitLimit))
    if (commitLimit !== settings.commitLimit) void saveSettings({ commitLimit })
  }
  return (
    <>
      <label className="field">
        <span>{t('settings.theme')}</span>
        <select value={settings.theme} onChange={(e) => void saveSettings({ theme: e.target.value as ThemeSetting })}>
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
          <option value="light">{t('settings.themeLight')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('settings.language')}</span>
        <select
          value={settings.language}
          onChange={(e) => void saveSettings({ language: e.target.value as Settings['language'] })}
        >
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
          onBlur={saveLimit}
          onKeyDown={(e) => e.key === 'Enter' && saveLimit()}
        />
      </label>
      <label className="field">
        <span>{t('settings.autoFetch')}</span>
        <select
          value={String(settings.autoFetchMinutes)}
          onChange={(e) => void saveSettings({ autoFetchMinutes: Number(e.target.value) })}
        >
          {[0, 1, 5, 10, 30].map((m) => (
            <option key={m} value={String(m)}>
              {m === 0 ? t('settings.autoFetchOff') : t('settings.autoFetchEvery', { count: m })}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>{t('settings.avatars')}</span>
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.avatars} onChange={(e) => void setAvatars(e.target.checked)} />
          {t('settings.avatarsShow')}
        </label>
        <div className="dim small">{t('settings.avatarsHint')}</div>
      </div>
    </>
  )
}

function AutoUpdateSettings() {
  const auto = useStore((s) => s.settings.autoUpdate)
  return <UpdateSettings auto={auto} onAuto={(value) => void saveSettings({ autoUpdate: value })} />
}

/** Every keyboard shortcut, as this system writes its keys. */
function ShortcutsList() {
  const t = useT()
  const mac = window.leviathan.platform === 'darwin'
  const names = { Space: t('keys.space'), Delete: t('keys.delete') }
  const keys = (k: string[]) => keysLabel(k, mac, names)
  return (
    <div className="shortcuts">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title}>
          <div className="shortcuts-title">{t(group.title)}</div>
          {group.items.map((item) => (
            <div key={item.label} className="shortcut">
              <kbd>{keys(mac && item.macKeys ? item.macKeys : item.keys)}</kbd>
              <span>{t(item.label, { keys: keys(['Mod', '/']) })}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

function About() {
  const t = useT()
  const versions = useStore((s) => s.versions)
  return (
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
  )
}
