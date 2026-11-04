import type React from 'react'
import { Check, Search, SkipForward, X } from 'lucide-react'
import { finishBisect, markBisect, selectCommit } from '../actions'
import { useT } from '../i18n'
import { useRepo } from '../store'
import { shortHash } from '../utils'

/** Above the graph while a bisect is under way: the commit to test and how it went, or the first bad one found. */
export function BisectBar({ path }: { path: string }) {
  const t = useT()
  const view = useRepo(path)
  const state = view?.state
  const bisect = state?.bisect
  if (!state || !bisect) return null
  const subject = (hash: string) => view.commits.find((c) => c.hash === hash)?.subject ?? ''
  const commit = (hash: string) => (
    <button
      className="bisect-commit"
      title={t('bisect.showCommit')}
      onClick={() => void selectCommit(path, hash, true)}
    >
      <code>{shortHash(hash)}</code> <span className="ellipsis">{subject(hash)}</span>
    </button>
  )
  const finish = (primary: boolean) => (
    <button className={primary ? 'btn small btn-primary' : 'btn small'} onClick={() => void finishBisect(path)}>
      {primary ? t('bisect.finish') : t('bisect.stop')}
    </button>
  )
  const head = state.head.hash

  let body: React.ReactNode
  let actions: React.ReactNode
  if (bisect.firstBad) {
    body = (
      <>
        <strong>{t('bisect.found')}</strong>
        {commit(bisect.firstBad)}
      </>
    )
    actions = finish(true)
  } else if (bisect.suspects) {
    body = (
      <>
        <strong>{t('bisect.onlySkipped', { count: bisect.suspects.length })}</strong>
        <span className="dim">{bisect.suspects.map((h) => shortHash(h)).join(', ')}</span>
      </>
    )
    actions = finish(true)
  } else if (!bisect.bad || !bisect.good.length) {
    body = (
      <>
        <strong>{t('bisect.title')}</strong>
        <span className="dim">{bisect.bad ? t('bisect.needGood') : t('bisect.needBad')}</span>
      </>
    )
    actions = (
      <>
        {head && (
          <button className="btn small" onClick={() => void markBisect(path, bisect.bad ? 'good' : 'bad')}>
            {bisect.bad ? t('bisect.headGood') : t('bisect.headBad')}
          </button>
        )}
        {finish(false)}
      </>
    )
  } else {
    body = (
      <>
        <strong>{t('bisect.test')}</strong>
        {head && commit(head)}
        <span className="dim">{bisect.steps ? t('bisect.left', { count: bisect.steps }) : t('bisect.lastStep')}</span>
      </>
    )
    actions = (
      <>
        <button
          className="btn small bisect-good"
          title={t('bisect.goodTitle')}
          onClick={() => void markBisect(path, 'good')}
        >
          <Check size={13} /> {t('bisect.good')}
        </button>
        <button
          className="btn small bisect-bad"
          title={t('bisect.badTitle')}
          onClick={() => void markBisect(path, 'bad')}
        >
          <X size={13} /> {t('bisect.bad')}
        </button>
        <button className="btn small" title={t('bisect.skipTitle')} onClick={() => void markBisect(path, 'skip')}>
          <SkipForward size={13} /> {t('bisect.skip')}
        </button>
        {finish(false)}
      </>
    )
  }

  return (
    <div className="bisect-bar" role="status">
      <Search size={15} className="bisect-icon" />
      <div className="bisect-text">{body}</div>
      <div className="bisect-actions">{actions}</div>
    </div>
  )
}
