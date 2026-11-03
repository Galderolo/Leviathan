import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, X } from 'lucide-react'
import type { DiffSource, FileChange, FileDiff } from '../../../shared/types'
import { closeCompare, swapCompare } from '../actions'
import { useT } from '../i18n'
import { useRepo } from '../store'
import { errorMessage } from '../ui'
import { cx, splitPath } from '../utils'
import { StatusBadge } from './common'
import { DiffLayoutToggle } from './DiffLines'
import { ReadOnlyDiff } from './FileViews'

const api = window.leviathan

/** Two commits compared in the center panel (or a commit and the working tree): the files that differ, and each diff. */
export function CompareView({ path }: { path: string }) {
  const compare = useRepo(path)?.compare
  if (!compare) return null
  const key = `${compare.from.hash}:${compare.to?.hash ?? ''}`
  return <Comparison key={key} path={path} {...compare} />
}

function Comparison({
  path,
  from,
  to
}: {
  path: string
  from: { hash: string; label: string }
  to: { hash: string; label: string } | null
}) {
  const t = useT()
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<FileChange | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  // Compared with the working tree, the files are read again as they change.
  const state = useRepo(path)?.state
  const tree = to === null

  useEffect(() => {
    let live = true
    api.compareFiles(path, from.hash, to?.hash ?? null).then(
      (list) => {
        if (!live) return
        setFiles(list)
        setError(null)
        setPicked((prev) => list.find((f) => f.path === prev?.path) ?? list[0] ?? null)
      },
      (err) => live && setError(errorMessage(err))
    )
    return () => {
      live = false
    }
  }, [path, from.hash, to?.hash, tree ? state : null])

  const source = useMemo<DiffSource | null>(() => {
    if (!picked) return null
    const oldPath = picked.status === 'R' ? picked.origPath : undefined
    return to
      ? { kind: 'commit', hash: to.hash, parent: from.hash, path: picked.path, ...(oldPath ? { oldPath } : {}) }
      : { kind: 'tree', base: from.hash, path: picked.path, ...(oldPath ? { oldPath } : {}) }
  }, [picked, from.hash, to])

  useEffect(() => {
    if (!source) return
    let live = true
    setDiffError(null)
    api
      .getDiff(path, source)
      .then((d) => live && setDiff(d))
      .catch((err) => live && setDiffError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, source, tree ? state : null])

  return (
    <div className="diff-view compare-view">
      <div className="diff-header">
        <div className="diff-title">
          <span className="diff-context">{t('compare.title')}</span>
          <code className="compare-side">{from.label}</code>
          <span className="dim">→</span>
          <code className="compare-side">{to ? to.label : t('compare.workingTree')}</code>
        </div>
        <div className="diff-actions">
          <DiffLayoutToggle />
          <button className="icon-btn" title={t('compare.swap')} disabled={tree} onClick={() => swapCompare(path)}>
            <ArrowLeftRight size={15} />
          </button>
          <button className="icon-btn" title={`${t('diff.close')} (Esc)`} onClick={() => closeCompare(path)}>
            <X size={16} />
          </button>
        </div>
      </div>
      {error && <div className="empty-state error">{error}</div>}
      {!error && !files && <div className="empty-state">{t('graph.loading')}</div>}
      {files && files.length === 0 && <div className="empty-state">{t('compare.same')}</div>}
      {files && files.length > 0 && (
        <div className="history-layout">
          <div className="history-list">
            <div className="compare-count">{t('compare.files', { count: files.length })}</div>
            {files.map((file) => {
              const { dir, name } = splitPath(file.path)
              return (
                <div
                  key={file.path}
                  className={cx('file-row', picked?.path === file.path && 'active')}
                  title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
                  onClick={() => setPicked(file)}
                >
                  <StatusBadge status={file.status} />
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
            {!diffError && !diff && <div className="empty-state">{t('graph.loading')}</div>}
            {diff && <ReadOnlyDiff data={diff} repo={path} source={source} />}
          </div>
        </div>
      )}
    </div>
  )
}
