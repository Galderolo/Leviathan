import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { REBASE_ACTIONS, rebaseProblem, type RebaseAction, type RebaseItem } from '../../../shared/rebase'
import type { RebaseCommit } from '../../../shared/types'
import { closeInteractiveRebase, startInteractiveRebase } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { cx } from '../utils'

export function RebaseDialog() {
  const rebase = useStore((s) => s.rebase)
  if (!rebase) return null
  return <RebaseForm key={`${rebase.path}:${rebase.base}`} {...rebase} />
}

/**
 * Edits the plan for the commits after `base`. `items` is in the order git applies
 * them (oldest first); the list shows it newest first, like the graph.
 */
function RebaseForm({ path, base, commits }: { path: string; base: string; commits: RebaseCommit[] }) {
  const t = useT()
  const branch = useStore((s) => s.repos[path]?.state?.head.branch) ?? 'HEAD'
  const [items, setItems] = useState<RebaseItem[]>(() => commits.map((c) => ({ hash: c.hash, action: 'pick' })))
  const [running, setRunning] = useState(false)
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const problem = rebaseProblem(items)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useStore.getState().dialog) closeInteractiveRebase()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const update = (index: number, patch: Partial<RebaseItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  // +1 moves a commit up the list (applied later), -1 down (applied earlier).
  const move = (index: number, delta: 1 | -1) =>
    setItems((prev) => {
      const to = index + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  const start = async () => {
    setRunning(true)
    await startInteractiveRebase(path, base, items)
  }

  const rows = items.map((item, index) => ({ item, index })).reverse()
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !running && closeInteractiveRebase()}
    >
      <form
        className="modal rebase-modal"
        onSubmit={(e) => {
          e.preventDefault()
          if (!problem && !running) void start()
        }}
      >
        <div className="modal-title">{t('rebase.title', { branch })}</div>
        <p className="modal-message">{t('rebase.hint', { base: base.slice(0, 7) })}</p>
        <div className="rebase-list">
          {rows.map(({ item, index }) => {
            const commit = byHash.get(item.hash)
            const melded = item.action === 'squash' || item.action === 'fixup'
            return (
              <div
                key={item.hash}
                className={cx('rebase-row', item.action === 'drop' && 'dropped', melded && 'melded')}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                  e.preventDefault()
                  move(index, e.key === 'ArrowUp' ? 1 : -1)
                }}
              >
                <div className="rebase-line">
                  <select
                    value={item.action}
                    disabled={running}
                    onChange={(e) =>
                      update(index, {
                        action: e.target.value as RebaseAction,
                        message: item.message ?? commit?.message ?? ''
                      })
                    }
                  >
                    {REBASE_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {t(`rebase.${action}`)}
                      </option>
                    ))}
                  </select>
                  <span className="rebase-hash">{item.hash.slice(0, 7)}</span>
                  <span className="rebase-subject">{commit?.subject}</span>
                  <span className="rebase-author">{commit?.author}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('rebase.moveUp')}
                    disabled={running || index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('rebase.moveDown')}
                    disabled={running || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                {item.action === 'reword' && (
                  <textarea
                    className="rebase-message"
                    rows={3}
                    value={item.message ?? ''}
                    disabled={running}
                    onChange={(e) => update(index, { message: e.target.value })}
                  />
                )}
              </div>
            )
          })}
        </div>
        {problem && <div className="rebase-problem">{t(`rebase.problem.${problem}`)}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={running} onClick={closeInteractiveRebase}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!!problem || running}>
            {t('rebase.start')}
          </button>
        </div>
      </form>
    </div>
  )
}
