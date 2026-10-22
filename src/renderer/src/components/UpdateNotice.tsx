import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { UpdateState } from '../../../shared/updates'
import { useT } from '../i18n'
import { useStore } from '../store'
import { errorMessage, toast } from '../ui'

const api = window.leviathan

/** Status bar notice for a newer release: found, downloading, ready to install. */
export function UpdateNotice() {
  const t = useT()
  const update = useStore((s) => s.update)
  if (!update) return null
  if (update.status === 'available' && update.version) {
    return (
      <span className="update-notice">
        {t('update.available', { version: update.version })}
        <button className="btn tiny btn-primary" onClick={() => void api.downloadUpdate().catch(report)}>
          <Download size={12} /> {t(update.mode === 'install' ? 'update.download' : 'update.openPage')}
        </button>
      </span>
    )
  }
  if (update.status === 'downloading') {
    return <span className="update-notice">{t('update.downloading', { percent: update.percent ?? 0 })}</span>
  }
  if (update.status === 'ready') {
    return (
      <span className="update-notice">
        {t('update.ready', { version: update.version ?? '' })}
        <button className="btn tiny btn-primary" onClick={() => void api.installUpdate().catch(report)}>
          <RefreshCw size={12} /> {t('update.restart')}
        </button>
      </span>
    )
  }
  return null
}

function report(err: unknown): void {
  toast('error', errorMessage(err))
}

/** Settings row: automatic checks on/off and a manual check with its result. */
export function UpdateSettings({ auto, onAuto }: { auto: boolean; onAuto: (value: boolean) => void }) {
  const t = useT()
  const update = useStore((s) => s.update)
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    try {
      useStore.setState({ update: await api.checkForUpdates() })
    } catch (err) {
      report(err)
    } finally {
      setChecking(false)
    }
  }
  const result = (state: UpdateState | null): string | null => {
    if (!state || state.status === 'idle' || state.status === 'checking') return null
    if (state.mode === 'off') return t('update.devBuild')
    if (state.status === 'none') return t('update.latest')
    if (state.status === 'error') return t('update.failed', { error: state.error ?? '' })
    return t('update.available', { version: state.version ?? '' })
  }
  return (
    <div className="field">
      <span>{t('update.title')}</span>
      <div className="input-row">
        <label className="checkbox-row">
          <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
          {t('update.auto')}
        </label>
        <button type="button" className="btn small" disabled={checking} onClick={() => void check()}>
          {t('update.checkNow')}
        </button>
      </div>
      {result(update) && <div className="dim small">{result(update)}</div>}
    </div>
  )
}
