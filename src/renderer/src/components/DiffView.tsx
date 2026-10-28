import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { supportsLineSelection } from '../../../shared/patch'
import type { DiffHunk, FileChange, SubmoduleChange } from '../../../shared/types'
import { applyHunk, applyLines, closeDiff, discardFiles, openInEditor, stageFiles, unstageFiles } from '../actions'
import { useT } from '../i18n'
import { ConflictView } from './ConflictView'
import { useRepo, useRepoSetting, useStore } from '../store'
import { highlightHunks } from '../syntax'
import { DiffFullFileToggle, DiffLayoutToggle, GapLines, LineText, SplitHunkLines, wordSpans } from './DiffLines'
import { cx, shortHash, splitPath } from '../utils'

const LINE_LIMIT = 3000

export function DiffView({ path }: { path: string }) {
  const view = useRepo(path)
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  // Lines picked for line-level staging; only one hunk at a time.
  const [picked, setPicked] = useState<{ hunk: number; lines: Set<number> } | null>(null)
  const anchor = useRef<number | null>(null)
  const diff = view?.diff
  const data = diff?.data
  const layout = useStore((s) => s.diffLayout)
  // Every hook before the early returns: the same view goes from a conflict to a plain diff once it is resolved.
  const hasEditor = !!useRepoSetting(path, 'editor').trim()
  const spansByHunk = useMemo(() => data?.hunks.map(wordSpans) ?? [], [data])
  const syntaxByHunk = useMemo(() => (data ? highlightHunks(data.hunks, data.path) : []), [data])
  // Each gap of unchanged lines is highlighted as a hunk of its own.
  const syntaxByGap = useMemo(() => (data?.gaps ? highlightHunks(data.gaps.map(gapHunk), data.path) : []), [data])

  useEffect(() => {
    setPicked(null)
    anchor.current = null
  }, [data])

  if (!diff) return null
  if (diff.source.kind === 'unstaged' && diff.source.conflicted) {
    return <ConflictView key={diff.source.path} path={path} file={diff.source.path} />
  }
  const { source, error } = diff
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

  /** Click on the gutter toggles a line; shift-click selects a range within the hunk. */
  const pickLine = (hunkIndex: number, lineIndex: number, range: boolean) => {
    const lines = data?.hunks[hunkIndex]?.lines
    const hunk = data?.hunks[hunkIndex]
    if (!hunkMode || !lines || !hunk || !supportsLineSelection(hunk)) return
    const isChange = (i: number) => lines[i]?.type === 'add' || lines[i]?.type === 'del'
    if (!isChange(lineIndex)) return
    setPicked((prev) => {
      const next = new Set(prev?.hunk === hunkIndex ? prev.lines : [])
      if (range && prev?.hunk === hunkIndex && anchor.current !== null) {
        const [from, to] = [Math.min(anchor.current, lineIndex), Math.max(anchor.current, lineIndex)]
        for (let i = from; i <= to; i++) if (isChange(i)) next.add(i)
      } else if (next.has(lineIndex)) next.delete(lineIndex)
      else next.add(lineIndex)
      anchor.current = lineIndex
      return next.size ? { hunk: hunkIndex, lines: next } : null
    })
  }

  let budget = showAll ? Number.POSITIVE_INFINITY : LINE_LIMIT
  const totalLines =
    (data?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0) +
    (data?.gaps?.reduce((n, gap) => n + gap.length, 0) ?? 0)
  /** The unchanged lines before hunk `index` (after the last one for `hunks.length`), when the whole file is shown. */
  const gap = (index: number) => {
    const lines = data?.gaps?.[index]
    if (!lines?.length || budget <= 0) return null
    const shown = lines.slice(0, budget)
    budget -= shown.length
    return <GapLines lines={shown} split={layout === 'split'} syntax={syntaxByGap[index]} />
  }

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
          <DiffFullFileToggle />
          <DiffLayoutToggle />
          {source.kind !== 'commit' && (
            <button
              className="icon-btn"
              title={hasEditor ? t('tools.openInEditor') : t('menu.openFile')}
              // In the editor, at the first changed line.
              onClick={() => openInEditor(path, source.path, data?.hunks[0]?.newStart)}
            >
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
        {data?.submodule && <SubmoduleSummary change={data.submodule} />}
        {data && !data.binary && !data.submodule && data.hunks.length === 0 && (
          <div className="empty-state">
            {data.oldPath ? t('diff.renamedOnly', { path: data.oldPath }) : t('diff.noChanges')}
          </div>
        )}
        {data &&
          !data.binary &&
          !data.submodule &&
          data.hunks.map((hunk, hi) => {
            const before = gap(hi)
            if (budget <= 0) return <Fragment key={hi}>{before}</Fragment>
            const lines = hunk.lines.slice(0, budget)
            budget -= lines.length
            return (
              <Fragment key={hi}>
                {before}
                <div className="hunk">
                  <div className="hunk-header">
                    <code>{hunk.header}</code>
                    {picked?.hunk === hi && hunkMode && (
                      <span className="hunk-actions">
                        <button className="btn tiny" onClick={() => setPicked(null)}>
                          {t('diff.clearSelection')}
                        </button>
                        <button
                          className={cx('btn tiny', hunkMode === 'unstaged' ? 'btn-stage' : 'btn-unstage')}
                          disabled={view?.applying}
                          onClick={() =>
                            void applyLines(
                              path,
                              data,
                              hunk,
                              picked.lines,
                              hunkMode === 'unstaged' ? 'stage' : 'unstage'
                            )
                          }
                        >
                          {t(hunkMode === 'unstaged' ? 'diff.stageLines' : 'diff.unstageLines', {
                            count: picked.lines.size
                          })}
                        </button>
                      </span>
                    )}
                    {picked?.hunk !== hi && hunkMode === 'unstaged' && (
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
                    {picked?.hunk !== hi && hunkMode === 'staged' && (
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
                  {layout === 'split' ? (
                    <SplitHunkLines hunk={hunk} limit={lines.length} syntax={syntaxByHunk[hi]} />
                  ) : (
                    <div className="hunk-lines">
                      {lines.map((line, li) => {
                        const selectable =
                          !!hunkMode && supportsLineSelection(hunk) && (line.type === 'add' || line.type === 'del')
                        return (
                          <div
                            key={li}
                            className={cx(
                              'diff-line',
                              line.type,
                              conflictMarker(line.text) && 'marker',
                              selectable && 'selectable',
                              picked?.hunk === hi && picked.lines.has(li) && 'picked'
                            )}
                          >
                            <span
                              className="gutter"
                              title={selectable ? t('diff.pickLine') : undefined}
                              onMouseDown={(e) => selectable && e.shiftKey && e.preventDefault()}
                              onClick={(e) => pickLine(hi, li, e.shiftKey)}
                            >
                              <span className="ln">{line.oldNo ?? ''}</span>
                              <span className="ln">{line.newNo ?? ''}</span>
                              <span className="sign">
                                {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                              </span>
                            </span>
                            <LineText line={line} spans={spansByHunk[hi]?.get(li)} syntax={syntaxByHunk[hi]?.get(li)} />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </Fragment>
            )
          })}
        {data && !data.binary && !data.submodule && gap(data.hunks.length)}
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

/** Unchanged lines as a hunk of context, to highlight them like one. */
function gapHunk(lines: DiffHunk['lines']): DiffHunk {
  return { header: '', oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines, patch: '' }
}

function conflictMarker(text: string): boolean {
  return /^(<{7}|={7}|>{7})( |$)/.test(text)
}

/** A submodule's change: the commits it brings (+) or takes away (−), rather than two hashes. */
function SubmoduleSummary({ change }: { change: SubmoduleChange }) {
  const t = useT()
  const short = (hash: string | null) => (hash ? shortHash(hash) : '—')
  let title: string
  if (change.from && change.to) title = t('diff.submoduleMoved', { from: short(change.from), to: short(change.to) })
  else if (change.to) title = t('diff.submoduleAdded', { to: short(change.to) })
  else title = t('diff.submoduleRemoved', { from: short(change.from) })
  return (
    <div className="submodule-diff">
      <div className="submodule-diff-title">{title}</div>
      {change.missing && <div className="dim">{t('diff.submoduleMissing')}</div>}
      {!change.missing && change.from && change.from === change.to && (
        <div className="dim">{t('diff.submoduleSame')}</div>
      )}
      {change.commits.length > 0 && (
        <ul className="submodule-commits">
          {change.commits.map((c) => (
            <li key={c.hash + String(c.added)} className={c.added ? 'added' : 'removed'}>
              <span className="sub-sign">{c.added ? '+' : '−'}</span>
              <code>{shortHash(c.hash)}</code> {c.subject}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
