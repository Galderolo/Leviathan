import { useT } from '../i18n'
import { useActiveTab, useStore } from '../store'
import { Spinner } from './common'
import { UpdateNotice } from './UpdateNotice'

export function StatusBar() {
  const tab = useActiveTab()
  const view = useStore((s) => (tab?.path ? s.repos[tab.path] : undefined))
  const versions = useStore((s) => s.versions)
  const t = useT()

  const busy = view?.busy
  const commits = view?.commits.length ?? 0

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        {busy ? (
          <>
            <Spinner size={11} />
            <span>{t(`busy.${busy}`)}</span>
            {view?.progress && <span className="dim ellipsis">{view.progress}</span>}
          </>
        ) : view ? (
          <>
            <span className="dim">
              {t('status.commits', { count: commits })}
              {view.hasMore ? '+' : ''}
            </span>
            {view.lastFetchError && (
              <span className="status-warning" title={view.lastFetchError}>
                {t('status.fetchFailed')}
              </span>
            )}
          </>
        ) : (
          <span className="dim">{t('status.ready')}</span>
        )}
      </div>
      <div className="statusbar-right">
        <UpdateNotice />
        <span className="dim">
          Leviathan {versions.app} · git {versions.git}
        </span>
      </div>
    </div>
  )
}
