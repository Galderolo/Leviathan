import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { conflictCount, parseConflicts, resolveConflicts, type Choice, type Segment } from '../../../shared/conflicts'
import type { WorkingFile } from '../../../shared/types'
import { closeDiff, openFile, resolveWithContent, resolveWithSide } from '../actions'
import { useT } from '../i18n'
import { errorMessage } from '../ui'
import { cx, splitPath } from '../utils'

const api = window.leviathan

const CHOICES: { value: Exclude<Choice, null>; key: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { value: 'ours', key: 'conflict.useCurrent' },
  { value: 'theirs', key: 'conflict.useIncoming' },
  { value: 'ours-theirs', key: 'conflict.useBoth' },
  { value: 'theirs-ours', key: 'conflict.useBothReversed' }
]

function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="conflict-lines">
      {lines.map((line, i) => (
        <div key={i} className="conflict-line">
          {line.replace(/\r?\n$/, '') || ' '}
        </div>
      ))}
    </div>
  )
}

/** Resolves a conflicted file block by block, or by taking one side of the whole file. */
export function ConflictView({ path, file }: { path: string; file: string }) {
  const t = useT()
  const [read, setRead] = useState<WorkingFile | null>(null)
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [choices, setChoices] = useState<Choice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped to read the file again, e.g. after a save refused because it changed.
  const [version, setVersion] = useState(0)
  const { dir, name } = splitPath(file)

  useEffect(() => {
    let live = true
    setSegments(null)
    setError(null)
    api
      .readWorkingFile(path, file)
      .then((result) => {
        if (!live) return
        const parsed = result.text === null ? [] : parseConflicts(result.text)
        setRead(result)
        setSegments(parsed)
        setChoices(new Array(conflictCount(parsed)).fill(null))
      })
      .catch((err) => live && setError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, file, version])

  const takeSide = async (side: 'ours' | 'theirs') => {
    setBusy(true)
    await resolveWithSide(path, file, side)
    setBusy(false)
  }

  const save = async (content: string, original: string) => {
    setBusy(true)
    if (!(await resolveWithContent(path, file, content, original))) setVersion((v) => v + 1)
    setBusy(false)
  }

  const total = segments ? conflictCount(segments) : 0
  const done = choices.filter(Boolean).length
  const result = segments ? resolveConflicts(segments, choices) : null
  const firstConflict = segments?.find((s) => s.kind === 'conflict')
  const oursLabel = firstConflict?.kind === 'conflict' ? firstConflict.oursLabel : ''
  const theirsLabel = firstConflict?.kind === 'conflict' ? firstConflict.theirsLabel : ''

  let conflictIndex = -1
  return (
    <div className="diff-view">
      <div className="diff-header">
        <div className="diff-title">
          <span className="diff-context">{t('diff.conflicted')}</span>
          <span className="file-dir">{dir}</span>
          <span className="file-name">{name}</span>
        </div>
        <div className="diff-actions">
          <button className="btn small" disabled={busy} onClick={() => void takeSide('ours')}>
            {t('conflict.takeCurrent')}
            {oursLabel && <span className="dim"> ({oursLabel})</span>}
          </button>
          <button className="btn small" disabled={busy} onClick={() => void takeSide('theirs')}>
            {t('conflict.takeIncoming')}
            {theirsLabel && <span className="dim"> ({theirsLabel})</span>}
          </button>
          <button className="icon-btn" title={t('menu.openFile')} onClick={() => openFile(path, file)}>
            <ExternalLink size={15} />
          </button>
          <button className="icon-btn" title={`${t('diff.close')} (Esc)`} onClick={() => closeDiff(path)}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="diff-body conflict-body">
        {error && <div className="empty-state error">{error}</div>}
        {!error && !segments && <div className="empty-state">{t('graph.loading')}</div>}
        {segments && total === 0 && (
          <div className="empty-state">
            {t(
              read?.reason === 'large'
                ? 'conflict.tooLarge'
                : read?.reason === 'encoding'
                  ? 'conflict.encoding'
                  : 'conflict.noMarkers'
            )}
          </div>
        )}
        {segments &&
          total > 0 &&
          segments.map((segment, si) => {
            if (segment.kind === 'common') {
              return (
                <div key={si} className="conflict-common">
                  <Lines lines={segment.lines} />
                </div>
              )
            }
            const index = ++conflictIndex
            const choice = choices[index]
            const pick = (value: Exclude<Choice, null>) =>
              setChoices((prev) => prev.map((c, i) => (i === index ? value : c)))
            return (
              <div key={si} className={cx('conflict-block', choice && 'resolved')}>
                <div className="conflict-sides">
                  <div className={cx('conflict-side', choice?.includes('ours') && 'chosen')}>
                    <div className="conflict-side-title">
                      {t('conflict.current')} <span className="dim">{segment.oursLabel}</span>
                    </div>
                    <Lines lines={segment.ours} />
                  </div>
                  <div className={cx('conflict-side', choice?.includes('theirs') && 'chosen')}>
                    <div className="conflict-side-title">
                      {t('conflict.incoming')} <span className="dim">{segment.theirsLabel}</span>
                    </div>
                    <Lines lines={segment.theirs} />
                  </div>
                </div>
                <div className="conflict-choices">
                  {CHOICES.map((c) => (
                    <button
                      key={c.value}
                      className={cx('btn tiny', choice === c.value && 'btn-primary')}
                      onClick={() => pick(c.value)}
                    >
                      {t(c.key)}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
      </div>

      {segments && total > 0 && (
        <div className="conflict-footer">
          <span className="dim">{t('conflict.progress', { done, count: total })}</span>
          <button
            className="btn btn-primary"
            disabled={result === null || busy}
            onClick={() => {
              if (result !== null && read?.text != null) void save(result, read.text)
            }}
          >
            {t('conflict.save')}
          </button>
        </div>
      )}
    </div>
  )
}
