import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { UpdateState } from '../../../shared/updates'
import { useT } from '../i18n'
import { useStore } from '../store'
import { t } from '../i18n'
import { confirmDialog, errorMessage, toast } from '../ui'
import { basename } from '../utils'

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
        <button
          className="btn tiny btn-primary"
          onClick={() =>
            void api
              .downloadUpdate()
              .catch((err) => toast('error', t('update.downloadFailed', { error: firstLine(err) })))
          }
        >
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
        <button className="btn tiny btn-primary" onClick={() => void restart()}>
          <RefreshCw size={12} /> {t('update.restart')}
        </button>
      </span>
    )
  }
  return null
}

function report(err: unknown): void {
  toast('error', firstLine(err))
}

/** electron-updater's errors carry stack traces and response headers: the first line says enough. */
export function firstLine(err: unknown): string {
  return (typeof err === 'string' ? err : errorMessage(err)).split('\n')[0].slice(0, 200)
}

/** Restarts into the downloaded version, unless that would cut work short or lose a message being written. */
async function restart(): Promise<void> {
  const repos = Object.values(useStore.getState().repos)
  if (repos.some((r) => r.busy || r.applying)) {
    toast('info', t('update.waitForWork'))
    return
  }
  const drafting = repos.filter((r) => r.draft.summary.trim() || r.draft.body.trim())
  if (drafting.length) {
    const ok = await confirmDialog({
      title: t('update.restart'),
      message: t('update.loseDraft', { repos: drafting.map((r) => basename(r.path)).join(', ') }),
      confirmText: t('update.restart')
    })
    if (!ok) return
  }
  await api.installUpdate().catch(report)
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
    if (state?.mode === 'off') return t('update.devBuild')
    if (!state || state.status === 'idle' || state.status === 'checking') return null
    if (state.status === 'unsupported') return t('update.unsupported')
    if (state.status === 'none') return t('update.latest')
    if (state.status === 'error') return t('update.failed', { error: firstLine(state.error ?? '') })
    if (state.status === 'downloading') return t('update.downloading', { percent: state.percent ?? 0 })
    if (state.status === 'ready') return t('update.ready', { version: state.version ?? '' })
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
      {result(update) && <div className="dim small update-result">{result(update)}</div>}
    </div>
  )
}
