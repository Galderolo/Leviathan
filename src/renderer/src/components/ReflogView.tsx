import { useEffect, useMemo, useState } from 'react'
import { GitBranchPlus, X } from 'lucide-react'
import { reflogKind, type Reflog, type ReflogEntry } from '../../../shared/reflog'
import { closeReflog, createBranch, selectCommit, showCommitInGraph } from '../actions'
import type { TKey, Vars } from '../i18n'
import { useT } from '../i18n'
import { commitMenu } from '../menus'
import { useRepo, useStore } from '../store'
import { errorMessage, openMenu } from '../ui'
import { cx, formatDate, relativeDate, shortHash } from '../utils'

const api = window.leviathan

/** What an entry says happened, in the app's words where git's are known: `moving from main to feature`... */
export function reflogText(t: (key: TKey, vars?: Vars) => string, entry: ReflogEntry): string {
  const kind = reflogKind(entry.action)
  if (kind === 'commit' || kind === 'amend') return entry.detail || entry.subject
  const moved = /^moving from (.+) to (.+)$/.exec(entry.detail)
  if (moved) return t('reflog.movedFrom', { from: moved[1], to: moved[2] })
  const to = /^moving to (.+)$/.exec(entry.detail)
  if (to) return t('reflog.movedTo', { to: to[1] })
  return entry.detail || entry.subject
}

/** Where HEAD has been, in the center panel: picking an entry shows its commit; a lost one can get a branch again. */
export function ReflogView({ path }: { path: string }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const state = useRepo(path)?.state
  const selection = useRepo(path)?.selection
  const [reflog, setReflog] = useState<Reflog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyLost, setOnlyLost] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)

  // Read again whenever HEAD or a ref moves: a new entry, or a lost commit that has a branch now.
  const key = useMemo(
    () => (state ? [state.head.hash, ...state.refs.map((r) => `${r.fullName}=${r.hash}`)].join('\n') : null),
    [state]
  )
  useEffect(() => {
    if (key === null) return
    let live = true
    api.getReflog(path).then(
      (r) => {
        if (!live) return
        setReflog(r)
        setError(null)
      },
      (err) => live && setError(errorMessage(err))
    )
    return () => {
      live = false
    }
  }, [path, key])

  const lostCount = useMemo(() => new Set(reflog?.entries.filter((e) => e.lost).map((e) => e.hash)).size, [reflog])
  const shown = reflog ? (onlyLost ? reflog.entries.filter((e) => e.lost) : reflog.entries) : []
  const selectedHash = selection && selection.kind !== 'wip' ? selection.hash : null

  const pick = (entry: ReflogEntry) => {
    setPicked(entry.index)
    void selectCommit(path, entry.hash)
  }

  return (
    <div className="diff-view reflog-view">
      <div className="diff-header">
        <div className="diff-title">
          <span className="diff-context">{t('reflog.title')}</span>
          <span className="dim">{t('reflog.subtitle')}</span>
        </div>
        <div className="diff-actions">
          <label className="checkbox small">
            <input type="checkbox" checked={onlyLost} onChange={(e) => setOnlyLost(e.target.checked)} />
            {t('reflog.onlyLost', { count: lostCount })}
          </label>
          <button className="icon-btn" title={`${t('diff.close')} (Esc)`} onClick={() => closeReflog(path)}>
            <X size={16} />
          </button>
        </div>
      </div>
      {error && <div className="empty-state error">{error}</div>}
      {!error && !reflog && <div className="empty-state">{t('graph.loading')}</div>}
      {reflog && (
        <div className="reflog-list">
          <div className="reflog-intro dim small">{t('reflog.intro')}</div>
          {shown.length === 0 && (
            <div className="empty-state">{onlyLost ? t('reflog.noneLost') : t('reflog.empty')}</div>
          )}
          {shown.map((entry) => {
            const kind = reflogKind(entry.action)
            const text = reflogText(t, entry)
            const selected = picked === entry.index && selectedHash === entry.hash
            const extra = [
              text !== entry.subject ? entry.subject : null,
              shortHash(entry.hash),
              relativeDate(entry.date, lang)
            ].filter(Boolean)
            return (
              <div
                key={entry.index}
                className={cx('history-row reflog-row', selected && 'selected', entry.lost && 'lost')}
                title={`HEAD@{${entry.index}} · ${entry.action}: ${entry.detail}\n${formatDate(entry.date, lang)}`}
                onClick={() => pick(entry)}
                onDoubleClick={() => !entry.lost && void showCommitInGraph(path, entry.hash)}
                onContextMenu={(e) => {
                  pick(entry)
                  openMenu(e, commitMenu(path, entry.hash))
                }}
              >
                <span className={cx('reflog-kind', kind)}>
                  {kind === 'other' ? entry.action : t(`reflog.kind.${kind}`)}
                </span>
                <div className="history-text">
                  <span className="history-subject">{text}</span>
                  <span className="dim small">{extra.join(' · ')}</span>
                </div>
                {entry.lost && (
                  <>
                    <span className="reflog-lost" title={t('reflog.lostTitle')}>
                      {t('reflog.lost')}
                    </span>
                    <button
                      className="btn small"
                      title={t('reflog.recoverTitle')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void createBranch(path, entry.hash)
                      }}
                    >
                      <GitBranchPlus size={13} /> {t('reflog.recover')}
                    </button>
                  </>
                )}
              </div>
            )
          })}
          {reflog.more && !onlyLost && (
            <div className="history-more">
              <span className="dim small">{t('reflog.more', { count: reflog.entries.length })}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
