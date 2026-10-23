import { useEffect, useMemo, useState } from 'react'
import { GitCommitHorizontal, X } from 'lucide-react'
import type { BlameLine, FileCommit, FileDiff } from '../../../shared/types'
import { closeFileView, showCommitInGraph } from '../actions'
import { useT } from '../i18n'
import { useRepo, useStore } from '../store'
import { errorMessage } from '../ui'
import { cx, formatDate, relativeDate, shortHash, splitPath } from '../utils'
import { historyDiffSource } from '../historyDiff'
import { Avatar } from './common'
import { highlightHunks } from '../syntax'
import { DiffLayoutToggle, LineText, SplitHunkLines, wordSpans } from './DiffLines'

const api = window.leviathan
const LINE_LIMIT = 3000
const NOT_COMMITTED = /^0+$/

/** File history or blame, in place of the graph, when one is open. */
export function FileView({ path }: { path: string }) {
  const fileView = useRepo(path)?.fileView
  if (!fileView) return null
  return fileView.kind === 'history' ? (
    <FileHistoryView key={`${fileView.path}@${fileView.rev}`} path={path} file={fileView.path} rev={fileView.rev} />
  ) : (
    <BlameView key={`${fileView.path}@${fileView.rev}`} path={path} file={fileView.path} rev={fileView.rev} />
  )
}

function Header(props: { path: string; context: string; file: string; children?: React.ReactNode }) {
  const t = useT()
  const { dir, name } = splitPath(props.file)
  return (
    <div className="diff-header">
      <div className="diff-title">
        <span className="diff-context">{props.context}</span>
        <span className="file-dir">{dir}</span>
        <span className="file-name">{name}</span>
      </div>
      <div className="diff-actions">
        {props.children}
        <button className="icon-btn" title={`${t('diff.close')} (Esc)`} onClick={() => closeFileView(props.path)}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

/** The commits that touched a file (following renames), and its diff in the one picked. */
function FileHistoryView({ path, file, rev }: { path: string; file: string; rev: string | null }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const [items, setItems] = useState<FileCommit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .getFileHistory(path, file, rev)
      .then((list) => live && setItems(list))
      .catch((err) => live && setError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, file, rev])

  const item = items?.[picked]
  useEffect(() => {
    if (!item) return
    let live = true
    setDiff(null)
    setDiffError(null)
    api
      .getDiff(path, historyDiffSource(item))
      .then((d) => live && setDiff(d))
      .catch((err) => live && setDiffError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, item])

  return (
    <div className="diff-view file-view">
      <Header path={path} context={t('history.title')} file={file}>
        <DiffLayoutToggle />
        {item && (
          <button className="btn small" onClick={() => void showCommitInGraph(path, item.commit.hash)}>
            <GitCommitHorizontal size={13} /> {t('history.showInGraph')}
          </button>
        )}
      </Header>
      {error && <div className="empty-state error">{error}</div>}
      {!error && !items && <div className="empty-state">{t('graph.loading')}</div>}
      {items && items.length === 0 && <div className="empty-state">{t('history.empty')}</div>}
      {items && items.length > 0 && (
        <div className="history-layout">
          <div className="history-list">
            {items.map((entry, i) => (
              <div
                key={entry.commit.hash}
                className={cx('history-row', i === picked && 'selected')}
                onClick={() => setPicked(i)}
                onDoubleClick={() => void showCommitInGraph(path, entry.commit.hash)}
                title={entry.oldPath ? t('history.renamedFrom', { path: entry.oldPath }) : entry.path}
              >
                <Avatar name={entry.commit.authorName} email={entry.commit.authorEmail} size={18} />
                <div className="history-text">
                  <span className="history-subject">{entry.commit.subject}</span>
                  <span className="dim small">
                    {entry.commit.authorName} · {relativeDate(entry.commit.authorDate, lang)} ·{' '}
                    {shortHash(entry.commit.hash)}
                    {entry.oldPath && ` · ${t('history.renamedFrom', { path: entry.oldPath })}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="diff-body">
            {diffError && <div className="empty-state error">{diffError}</div>}
            {!diffError && !diff && <div className="empty-state">{t('graph.loading')}</div>}
            {diff && <ReadOnlyDiff data={diff} />}
          </div>
        </div>
      )}
    </div>
  )
}

/** Hunks of a diff, read-only. */
export function ReadOnlyDiff({ data }: { data: FileDiff }) {
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  const layout = useStore((s) => s.diffLayout)
  const spansByHunk = useMemo(() => data.hunks.map(wordSpans), [data])
  const syntaxByHunk = useMemo(() => highlightHunks(data.hunks, data.path), [data])
  if (data.binary) return <div className="empty-state">{t('diff.binary')}</div>
  if (!data.hunks.length) return <div className="empty-state">{t('diff.noChanges')}</div>
  let budget = showAll ? Number.POSITIVE_INFINITY : LINE_LIMIT
  const total = data.hunks.reduce((n, h) => n + h.lines.length, 0)
  return (
    <>
      {data.hunks.map((hunk, hi) => {
        if (budget <= 0) return null
        const lines = hunk.lines.slice(0, budget)
        budget -= lines.length
        return (
          <div className="hunk" key={hi}>
            <div className="hunk-header">
              <code>{hunk.header}</code>
            </div>
            {layout === 'split' ? (
              <SplitHunkLines hunk={hunk} limit={lines.length} syntax={syntaxByHunk[hi]} />
            ) : (
              <div className="hunk-lines">
                {lines.map((line, li) => (
                  <div key={li} className={cx('diff-line', line.type)}>
                    <span className="gutter">
                      <span className="ln">{line.oldNo ?? ''}</span>
                      <span className="ln">{line.newNo ?? ''}</span>
                      <span className="sign">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
                    </span>
                    <LineText line={line} spans={spansByHunk[hi]?.get(li)} syntax={syntaxByHunk[hi]?.get(li)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {!showAll && total > LINE_LIMIT && (
        <div className="show-all">
          <button className="btn" onClick={() => setShowAll(true)}>
            {t('diff.showAll', { count: total })}
          </button>
        </div>
      )}
    </>
  )
}

/** Who last changed each line, grouped by commit; a click on a group shows its commit. */
function BlameView({ path, file, rev }: { path: string; file: string; rev: string | null }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const [lines, setLines] = useState<BlameLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let live = true
    api
      .getBlame(path, file, rev)
      .then((result) => live && setLines(result))
      .catch((err) => live && setError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, file, rev])

  const shown = lines && !showAll ? lines.slice(0, LINE_LIMIT) : lines
  const context = rev ? t('blame.at', { hash: shortHash(rev) }) : t('blame.working')
  return (
    <div className="diff-view file-view">
      <Header path={path} context={`${t('blame.title')} · ${context}`} file={file} />
      <div className="diff-body">
        {error && <div className="empty-state error">{error}</div>}
        {!error && !lines && <div className="empty-state">{t('graph.loading')}</div>}
        {shown && (
          <div className="blame-lines">
            {shown.map((line, i) => {
              const first = i === 0 || shown[i - 1].hash !== line.hash
              const pending = NOT_COMMITTED.test(line.hash)
              return (
                <div key={i} className={cx('blame-line', first && 'block-start')}>
                  <span
                    className={cx('blame-info', !pending && 'link')}
                    title={pending ? undefined : `${line.summary}\n${line.author} · ${formatDate(line.date, lang)}`}
                    onClick={() => !pending && void showCommitInGraph(path, line.hash)}
                  >
                    {first &&
                      (pending ? (
                        <span className="dim">{t('blame.notCommitted')}</span>
                      ) : (
                        <>
                          <span className="blame-hash">{shortHash(line.hash)}</span>
                          <span className="blame-author">{line.author}</span>
                          <span className="dim">{relativeDate(line.date, lang)}</span>
                        </>
                      ))}
                  </span>
                  <span className="ln">{line.line}</span>
                  <span className="code">{line.text || ' '}</span>
                </div>
              )
            })}
          </div>
        )}
        {lines && !showAll && lines.length > LINE_LIMIT && (
          <div className="show-all">
            <button className="btn" onClick={() => setShowAll(true)}>
              {t('diff.showAll', { count: lines.length })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
