import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, GitMerge, GripVertical } from 'lucide-react'
import {
  moveItem,
  parseRebaseScript,
  REBASE_ACTIONS,
  rebaseProblem,
  rebaseProblemWithMerges,
  type RebaseAction,
  type RebaseItem,
  type ScriptLine
} from '../../../shared/rebase'
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

/** What the list shows, newest first: commits, and with merges the merges and where each branch starts. */
type Row = { kind: 'commit'; item: RebaseItem; index: number } | { kind: 'merge'; subject: string } | { kind: 'branch' }

/** The rows of git's own list (with merges): each commit where git applies it, a merge row, a line between branches. */
function scriptRows(lines: ScriptLine[], items: RebaseItem[]): Row[] {
  const rows: Row[] = []
  for (const line of lines) {
    if (line.kind === 'pick') {
      const index = items.findIndex((i) => i.hash === line.hash)
      if (index >= 0) rows.push({ kind: 'commit', item: items[index], index })
    } else if (line.kind === 'merge') rows.push({ kind: 'merge', subject: line.subject })
    // Another branch's commits start: a line, unless nothing came before.
    else if (line.text.startsWith('reset ') && rows.length && rows[rows.length - 1].kind === 'commit') {
      rows.push({ kind: 'branch' })
    }
  }
  return rows
}

/**
 * Edits the plan for the commits after `base`. `items` is in the order git applies
 * them (oldest first); the list shows it newest first, like the graph. With merges (`script`, git's own list), the
 * merges are kept as they are and commits are not moved: only what happens to each commit changes.
 */
function RebaseForm({
  path,
  base,
  commits,
  script
}: {
  path: string
  base: string
  commits: RebaseCommit[]
  script: string | null
}) {
  const t = useT()
  const branch = useStore((s) => s.repos[path]?.state?.head.branch) ?? 'HEAD'
  const [items, setItems] = useState<RebaseItem[]>(() => commits.map((c) => ({ hash: c.hash, action: 'pick' })))
  const [running, setRunning] = useState(false)
  // Drag and drop by the grip: the commit being dragged and the row it is over (indexes in `items`).
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const runningRef = useRef(false)
  runningRef.current = running
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const lines = useMemo(() => (script === null ? null : parseRebaseScript(script, commits)), [script, commits])
  const movable = lines === null
  const problem = lines ? rebaseProblemWithMerges(lines, items) : rebaseProblem(items)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useStore.getState().dialog && !runningRef.current) closeInteractiveRebase()
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
  const endDrag = () => {
    setDragging(null)
    setOver(null)
  }
  const start = async () => {
    setRunning(true)
    if ((await startInteractiveRebase(path, base, items)) === 'refused') setRunning(false)
  }

  const rows: Row[] = (
    lines ? scriptRows(lines, items) : items.map((item, index): Row => ({ kind: 'commit', item, index }))
  ).reverse()
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
        <p className="modal-message">{t(movable ? 'rebase.hint' : 'rebase.mergesHint', { base: base.slice(0, 7) })}</p>
        <div className="rebase-list">
          {rows.map((row, at) => {
            if (row.kind === 'branch') return <div key={`branch-${at}`} className="rebase-branch-break" />
            if (row.kind === 'merge') {
              return (
                <div key={`merge-${at}`} className="rebase-row merge-row">
                  <div className="rebase-line">
                    <span className="rebase-merge-icon">
                      <GitMerge size={14} />
                    </span>
                    <span className="rebase-merge-kept">{t('rebase.mergeKept')}</span>
                    <span className="rebase-subject">{row.subject}</span>
                  </div>
                </div>
              )
            }
            const { item, index } = row
            const commit = byHash.get(item.hash)
            const melded = item.action === 'squash' || item.action === 'fixup'
            return (
              <div
                key={item.hash}
                className={cx(
                  'rebase-row',
                  item.action === 'drop' && 'dropped',
                  melded && 'melded',
                  dragging === index && 'dragging',
                  // The list is newest first: a commit moved later lands above the row, earlier below it.
                  over === index &&
                    dragging !== null &&
                    dragging !== index &&
                    (dragging < index ? 'drop-above' : 'drop-below')
                )}
                onDragOver={(e) => {
                  if (dragging === null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (over !== index) setOver(index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragging !== null) setItems((prev) => moveItem(prev, dragging, index))
                  endDrag()
                }}
                onKeyDown={(e) => {
                  if (!movable || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                  e.preventDefault()
                  move(index, e.key === 'ArrowUp' ? 1 : -1)
                }}
              >
                <div className="rebase-line">
                  {movable && (
                    <span
                      className="rebase-grip"
                      title={t('rebase.drag')}
                      draggable={!running}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', item.hash)
                        setDragging(index)
                      }}
                      onDragEnd={endDrag}
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
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
                  {movable && (
                    <>
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
                    </>
                  )}
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
