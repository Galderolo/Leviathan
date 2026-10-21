import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { FileChange } from '../../../shared/types'
import { applyHunk, closeDiff, discardFiles, openFile, stageFiles, unstageFiles } from '../actions'
import { useT } from '../i18n'
import { useRepo } from '../store'
import { cx, shortHash, splitPath } from '../utils'

const LINE_LIMIT = 3000

export function DiffView({ path }: { path: string }) {
  const view = useRepo(path)
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  const diff = view?.diff
  if (!diff) return null
  const { source, data, error } = diff
  const { dir, name } = splitPath(source.path)

  const asChange: FileChange = {
    path: source.path,
    status: source.kind === 'unstaged' && source.untracked ? '?' : 'M'
  }
  // Renamed files carry rename headers, so a single-hunk (reverse) patch would also undo the rename.
  const hunkMode = data?.oldPath
    ? null
    : source.kind === 'unstaged' && !source.untracked && !source.conflicted
      ? 'unstaged'
      : source.kind === 'staged'
        ? 'staged'
        : null

  let context: string
  if (source.kind === 'unstaged') context = source.conflicted ? t('diff.conflicted') : t('diff.unstaged')
  else if (source.kind === 'staged') context = t('diff.staged')
  else context = `${t('commit.commit')} ${shortHash(source.hash)}`

  let budget = showAll ? Number.POSITIVE_INFINITY : LINE_LIMIT
  const totalLines = data?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0

  return (
    <div className="diff-view">
      <div className="diff-header">
        <div className="diff-title">
          <span className="diff-context">{context}</span>
          <span className="file-dir">{dir}</span>
          <span className="file-name">{name}</span>
          {data?.oldPath && <span className="file-orig"> ← {data.oldPath}</span>}
        </div>
        <div className="diff-actions">
          {source.kind === 'unstaged' && !source.conflicted && (
            <>
              <button className="btn small btn-danger-ghost" onClick={() => void discardFiles(path, [asChange])}>
                {t('menu.discard')}
              </button>
              <button className="btn small btn-stage" onClick={() => void stageFiles(path, [asChange])}>
                {t('diff.stageFile')}
              </button>
            </>
          )}
          {source.kind === 'unstaged' && source.conflicted && (
            <button className="btn small btn-stage" onClick={() => void stageFiles(path, [asChange])}>
              {t('wip.markResolved')}
            </button>
          )}
          {source.kind === 'staged' && (
            <button className="btn small btn-unstage" onClick={() => void unstageFiles(path, [asChange])}>
              {t('diff.unstageFile')}
            </button>
          )}
          {source.kind !== 'commit' && (
            <button className="icon-btn" title={t('menu.openFile')} onClick={() => openFile(path, source.path)}>
              <ExternalLink size={15} />
            </button>
          )}
          <button className="icon-btn" title={`${t('diff.close')} (Esc)`} onClick={() => closeDiff(path)}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="diff-body">
        {error && <div className="empty-state error">{error}</div>}
        {!error && !data && <div className="empty-state">{t('graph.loading')}</div>}
        {data?.binary && <div className="empty-state">{t('diff.binary')}</div>}
        {data && !data.binary && data.hunks.length === 0 && <div className="empty-state">{t('diff.noChanges')}</div>}
        {data &&
          !data.binary &&
          data.hunks.map((hunk, hi) => {
            if (budget <= 0) return null
            const lines = hunk.lines.slice(0, budget)
            budget -= lines.length
            return (
              <div className="hunk" key={hi}>
                <div className="hunk-header">
                  <code>{hunk.header}</code>
                  {hunkMode === 'unstaged' && (
                    <span className="hunk-actions">
                      <button
                        className="btn tiny btn-danger-ghost"
                        disabled={view?.applying}
                        onClick={() => void applyHunk(path, data, hunk, 'discard')}
                      >
                        {t('diff.discardHunk')}
                      </button>
                      <button
                        className="btn tiny btn-stage"
                        disabled={view?.applying}
                        onClick={() => void applyHunk(path, data, hunk, 'stage')}
                      >
                        {t('diff.stageHunk')}
                      </button>
                    </span>
                  )}
                  {hunkMode === 'staged' && (
                    <span className="hunk-actions">
                      <button
                        className="btn tiny btn-unstage"
                        disabled={view?.applying}
                        onClick={() => void applyHunk(path, data, hunk, 'unstage')}
                      >
                        {t('diff.unstageHunk')}
                      </button>
                    </span>
                  )}
                </div>
                <div className="hunk-lines">
                  {lines.map((line, li) => (
                    <div key={li} className={cx('diff-line', line.type, conflictMarker(line.text) && 'marker')}>
                      <span className="ln">{line.oldNo ?? ''}</span>
                      <span className="ln">{line.newNo ?? ''}</span>
                      <span className="sign">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
                      <span className="code">{line.text || ' '}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        {data && !showAll && totalLines > LINE_LIMIT && (
          <div className="show-all">
            <button className="btn" onClick={() => setShowAll(true)}>
              {t('diff.showAll', { count: totalLines })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function conflictMarker(text: string): boolean {
  return /^(<{7}|={7}|>{7})( |$)/.test(text)
}
