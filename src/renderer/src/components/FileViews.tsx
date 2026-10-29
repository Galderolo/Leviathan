import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { ArrowLeft, GitCommitHorizontal, History, X } from 'lucide-react'
import { imageType } from '../../../shared/images'
import type { BlameLine, Commit, DiffSource, FileChange, FileCommit, FileDiff } from '../../../shared/types'
import { BLAME_MAX_LINES, HISTORY_MAX, HISTORY_PAGE } from '../../../shared/types'
import { blameBefore, closeFileView, fileViewBack, loadAvatars, openFolderHistory, showCommitInGraph } from '../actions'
import { useT } from '../i18n'
import { useRepo, useStore } from '../store'
import { errorMessage, openMenu } from '../ui'
import { cx, formatDate, relativeDate, shortHash, splitPath } from '../utils'
import { filesInFolder, folderSteps, historyDiffSource } from '../historyDiff'
import { Avatar, StatusBadge } from './common'
import { highlightHunks } from '../syntax'
import { ImageDiff } from './ImageDiff'
import { DiffLayoutToggle, LineText, SplitHunkLines, wordSpans } from './DiffLines'

const api = window.leviathan
const LINE_LIMIT = 3000
const NOT_COMMITTED = /^0+$/

/**
 * What a view from HEAD or the working tree (`rev` null) must be read again for: the commit HEAD is at, so a commit,
 * checkout or pull shows up in it. Null for a view of a given commit, which never changes.
 */
function useHeadKey(path: string, rev: string | null): string | null {
  const head = useRepo(path)?.state?.head.hash ?? null
  return rev === null ? head : null
}

/** File history or blame, in place of the graph, when one is open. */
export function FileView({ path }: { path: string }) {
  const fileView = useRepo(path)?.fileView
  if (!fileView) return null
  // Each step back in a blame is a view of its own.
  const key = `${fileView.kind}:${fileView.path}@${fileView.rev}#${fileView.back?.length ?? 0}`
  if (fileView.kind === 'folder')
    return <FolderHistoryView key={key} path={path} folder={fileView.path} rev={fileView.rev} />
  return fileView.kind === 'history' ? (
    <FileHistoryView key={key} path={path} file={fileView.path} rev={fileView.rev} />
  ) : (
    <BlameView
      key={key}
      path={path}
      file={fileView.path}
      rev={fileView.rev}
      target={fileView.line ?? null}
      canGoBack={!!fileView.back?.length}
    />
  )
}

/** The file or folder a view is about; each folder above it opens that folder's history. */
function Header(props: {
  path: string
  context: string
  file: string
  rev: string | null
  children?: React.ReactNode
}) {
  const t = useT()
  const { name } = splitPath(props.file)
  return (
    <div className="diff-header">
      <div className="diff-title">
        <span className="diff-context">{props.context}</span>
        <span className="file-dir">
          {folderSteps(props.file).map((step) => (
            <button
              key={step.folder}
              className="path-step"
              title={t('history.ofFolder', { folder: step.folder })}
              onClick={() => openFolderHistory(props.path, step.folder, props.rev)}
            >
              {step.label}
            </button>
          ))}
        </span>
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
  const [items, setItems] = useState<FileCommit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The commit picked, by hash: it stays picked when the list is read again with a new commit on top.
  const [pickedHash, setPickedHash] = useState<string | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [limit, setLimit] = useState(HISTORY_PAGE)
  const head = useHeadKey(path, rev)

  useEffect(() => {
    let live = true
    api
      .getFileHistory(path, file, rev, limit)
      .then((list) => {
        if (!live) return
        setItems(list)
        void loadAvatars(
          path,
          list.map((entry) => entry.commit)
        )
      })
      .catch((err) => live && setError(errorMessage(err)))
    return () => {
      // Closed, or asked again: git's work for this one is no longer wanted.
      live = false
      void api.stopFileView(path)
    }
  }, [path, file, rev, limit, head])

  const picked = Math.max(0, items?.findIndex((entry) => entry.commit.hash === pickedHash) ?? 0)
  const item = items?.[picked]
  const source = useMemo(() => (item ? historyDiffSource(item) : null), [item])
  useEffect(() => {
    if (!source) return
    let live = true
    setDiff(null)
    setDiffError(null)
    api
      .getDiff(path, source)
      .then((d) => live && setDiff(d))
      .catch((err) => live && setDiffError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, source])

  return (
    <div className="diff-view file-view">
      <Header path={path} context={t('history.title')} file={file} rev={rev}>
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
              <CommitRow
                key={entry.commit.hash}
                path={path}
                commit={entry.commit}
                selected={i === picked}
                onPick={() => setPickedHash(entry.commit.hash)}
                title={entry.oldPath ? t('history.renamedFrom', { path: entry.oldPath }) : entry.path}
                note={entry.oldPath && t('history.renamedFrom', { path: entry.oldPath })}
              />
            ))}
            <HistoryMore shown={items.length} limit={limit} onMore={setLimit} />
          </div>
          <div className="diff-body">
            {diffError && <div className="empty-state error">{diffError}</div>}
            {!diffError && !diff && <div className="empty-state">{t('graph.loading')}</div>}
            {diff && <ReadOnlyDiff data={diff} repo={path} source={source} />}
          </div>
        </div>
      )}
    </div>
  )
}

/** Below a history cut at `limit` commits: says so, and asks for more while the app may show more. */
function HistoryMore(props: { shown: number; limit: number; onMore: (limit: number) => void }) {
  const t = useT()
  if (props.shown < props.limit) return null
  return (
    <div className="history-more">
      <span className="dim small">{t('history.more', { count: props.shown })}</span>
      {props.limit < HISTORY_MAX && (
        <button className="btn small" onClick={() => props.onMore(Math.min(props.limit + HISTORY_PAGE, HISTORY_MAX))}>
          {t('history.showMore')}
        </button>
      )}
    </div>
  )
}

/** A commit in a history list; double-click shows it in the graph. */
function CommitRow(props: {
  path: string
  commit: Commit
  selected: boolean
  onPick: () => void
  title?: string
  /** Said after its author, date and hash. */
  note?: string
}) {
  const lang = useStore((s) => s.lang)
  const { commit } = props
  return (
    <div
      className={cx('history-row', props.selected && 'selected')}
      onClick={props.onPick}
      onDoubleClick={() => void showCommitInGraph(props.path, commit.hash)}
      title={props.title}
    >
      <Avatar name={commit.authorName} email={commit.authorEmail} size={18} />
      <div className="history-text">
        <span className="history-subject">{commit.subject}</span>
        <span className="dim small">
          {commit.authorName} · {relativeDate(commit.authorDate, lang)} · {shortHash(commit.hash)}
          {props.note && ` · ${props.note}`}
        </span>
      </div>
    </div>
  )
}

/** The commits that changed anything in a folder; the files the one picked changed there, and a file's diff. */
function FolderHistoryView({ path, folder, rev }: { path: string; folder: string; rev: string | null }) {
  const t = useT()
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickedHash, setPickedHash] = useState<string | null>(null)
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [file, setFile] = useState<FileChange | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const prefix = `${folder}/`
  const [limit, setLimit] = useState(HISTORY_PAGE)
  const head = useHeadKey(path, rev)

  useEffect(() => {
    let live = true
    api
      .getFolderHistory(path, folder, rev, limit)
      .then((list) => {
        if (!live) return
        setCommits(list)
        void loadAvatars(path, list)
      })
      .catch((err) => live && setError(errorMessage(err)))
    return () => {
      live = false
      void api.stopFileView(path)
    }
  }, [path, folder, rev, limit, head])

  const picked = Math.max(0, commits?.findIndex((c) => c.hash === pickedHash) ?? 0)
  const commit = commits?.[picked]
  useEffect(() => {
    if (!commit) return
    let live = true
    setFiles(null)
    setFile(null)
    setDiffError(null)
    api
      .getCommitDetails(path, commit.hash)
      .then((details) => {
        if (!live) return
        const inside = filesInFolder(details.files, folder)
        setFiles(inside)
        setFile(inside[0] ?? null)
      })
      .catch((err) => live && setDiffError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, folder, commit])

  const source = useMemo<DiffSource | null>(
    () =>
      commit && file
        ? {
            kind: 'commit',
            hash: commit.hash,
            parent: commit.parents[0] ?? null,
            path: file.path,
            // Only a rename compares with the old name (after a copy the original is still there).
            ...(file.status === 'R' && file.origPath ? { oldPath: file.origPath } : {})
          }
        : null,
    [commit, file]
  )
  useEffect(() => {
    if (!source) return
    let live = true
    setDiff(null)
    setDiffError(null)
    api
      .getDiff(path, source)
      .then((d) => live && setDiff(d))
      .catch((err) => live && setDiffError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, source])

  return (
    <div className="diff-view file-view folder-history">
      <Header path={path} context={t('history.folderTitle')} file={folder} rev={rev}>
        <DiffLayoutToggle />
        {commit && (
          <button className="btn small" onClick={() => void showCommitInGraph(path, commit.hash)}>
            <GitCommitHorizontal size={13} /> {t('history.showInGraph')}
          </button>
        )}
      </Header>
      {error && <div className="empty-state error">{error}</div>}
      {!error && !commits && <div className="empty-state">{t('graph.loading')}</div>}
      {commits && commits.length === 0 && <div className="empty-state">{t('history.folderEmpty')}</div>}
      {commits && commits.length > 0 && (
        <div className="history-layout">
          <div className="history-list">
            {commits.map((c, i) => (
              <CommitRow
                key={c.hash}
                path={path}
                commit={c}
                selected={i === picked}
                onPick={() => setPickedHash(c.hash)}
              />
            ))}
            <HistoryMore shown={commits.length} limit={limit} onMore={setLimit} />
          </div>
          <div className="folder-commit">
            <div className="folder-files">
              {files?.length === 0 && <div className="empty-state small">{t('history.folderNoFiles')}</div>}
              {files?.map((f) => {
                // Paths inside the folder, without it; a file moved out of it keeps its whole path.
                const { dir, name } = splitPath(f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path)
                return (
                  <div
                    key={f.path}
                    className={cx('file-row', file?.path === f.path && 'active')}
                    title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                    onClick={() => setFile(f)}
                  >
                    <StatusBadge status={f.status} />
                    <span className="file-path">
                      <span className="file-dir">{dir}</span>
                      <span className="file-name">{name}</span>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="diff-body">
              {diffError && <div className="empty-state error">{diffError}</div>}
              {!diffError && (!files || (file && !diff)) && <div className="empty-state">{t('graph.loading')}</div>}
              {diff && file && <ReadOnlyDiff data={diff} repo={path} source={source} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Hunks of a diff, read-only; with the `source` it was read from, an image shows as its pictures. */
export function ReadOnlyDiff({ data, repo, source }: { data: FileDiff; repo?: string; source?: DiffSource | null }) {
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  const layout = useStore((s) => s.diffLayout)
  const spansByHunk = useMemo(() => data.hunks.map(wordSpans), [data])
  const syntaxByHunk = useMemo(() => highlightHunks(data.hunks, data.path), [data])
  if (repo && source && imageType(source.path) && !data.submodule) {
    return <ImageDiff key={JSON.stringify(source)} repo={repo} source={source} version={data} />
  }
  if (data.binary) return <div className="empty-state">{t('diff.binary')}</div>
  if (!data.hunks.length) {
    return (
      <div className="empty-state">
        {data.oldPath ? t('diff.renamedOnly', { path: data.oldPath }) : t('diff.noChanges')}
      </div>
    )
  }
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
function BlameView(props: {
  path: string
  file: string
  rev: string | null
  /** The line to show first (where a line was, when looking before a change). */
  target: number | null
  canGoBack: boolean
}) {
  const { path, file, rev, target } = props
  const t = useT()
  const lang = useStore((s) => s.lang)
  const [lines, setLines] = useState<BlameLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A target further down than the first lines shows them all.
  const [showAll, setShowAll] = useState((target ?? 0) > LINE_LIMIT)
  const body = useRef<HTMLDivElement>(null)
  const head = useHeadKey(path, rev)

  useEffect(() => {
    let live = true
    api
      .getBlame(path, file, rev)
      .then((result) => live && setLines(result))
      .catch((err) => live && setError(errorMessage(err)))
    return () => {
      live = false
      void api.stopFileView(path)
    }
  }, [path, file, rev, head])

  useEffect(() => {
    if (lines && target) body.current?.querySelector('.blame-line.target')?.scrollIntoView({ block: 'center' })
  }, [lines, target])

  const lineMenu = (e: React.MouseEvent, line: BlameLine) =>
    openMenu(e, [
      { label: t('blame.before'), disabled: !line.previous, onClick: () => blameBefore(path, line) },
      {
        label: t('history.showInGraph'),
        disabled: NOT_COMMITTED.test(line.hash),
        onClick: () => void showCommitInGraph(path, line.hash)
      }
    ])

  const shown = lines && !showAll ? lines.slice(0, LINE_LIMIT) : lines
  const context = rev ? t('blame.at', { hash: shortHash(rev) }) : t('blame.working')
  return (
    <div className="diff-view file-view">
      <Header path={path} context={`${t('blame.title')} · ${context}`} file={file} rev={rev}>
        {props.canGoBack && (
          <button className="btn small" onClick={() => fileViewBack(path)}>
            <ArrowLeft size={13} /> {t('blame.back')}
          </button>
        )}
      </Header>
      <div className="diff-body" ref={body}>
        {error && <div className="empty-state error">{error}</div>}
        {!error && !lines && <div className="empty-state">{t('graph.loading')}</div>}
        {lines && lines.length >= BLAME_MAX_LINES && (
          <div className="blame-more dim small">{t('blame.more', { count: BLAME_MAX_LINES.toLocaleString(lang) })}</div>
        )}
        {shown && (
          <div className="blame-lines">
            {shown.map((line, i) => {
              const first = i === 0 || shown[i - 1].hash !== line.hash
              const pending = NOT_COMMITTED.test(line.hash)
              return (
                <div
                  key={i}
                  className={cx('blame-line', first && 'block-start', line.line === target && 'target')}
                  onContextMenu={(e) => lineMenu(e, line)}
                >
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
                          {line.previous && (
                            <button
                              className="icon-btn blame-before"
                              title={t('blame.before')}
                              onClick={(e) => {
                                e.stopPropagation()
                                blameBefore(path, line)
                              }}
                            >
                              <History size={12} />
                            </button>
                          )}
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
