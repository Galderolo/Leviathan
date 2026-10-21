import type { ReactNode } from 'react'
import { AlertTriangle, Copy, PencilLine } from 'lucide-react'
import type { DiffSource, FileChange } from '../../../shared/types'
import {
  abortOperation,
  applyStash,
  commit,
  continueOperation,
  dropStash,
  openDiff,
  popStash,
  selectCommit,
  selectWip,
  setAmend,
  stageAll,
  stageFiles,
  unstageAll,
  unstageFiles,
  updateDraft
} from '../actions'
import { useT } from '../i18n'
import { fileMenu } from '../menus'
import { useRepo, useStore, type RepoView } from '../store'
import { copyText, openMenu } from '../ui'
import { cx, formatDate, shortHash, splitPath } from '../utils'
import { Avatar, StatusBadge } from './common'

export function RightPanel({ path }: { path: string }) {
  const view = useRepo(path)
  const t = useT()
  if (!view?.state) return <div className="right-empty dim">{t('graph.loading')}</div>
  if (view.selection?.kind === 'wip') return <WorkingPanel path={path} view={view} />
  return (
    <div className="right-stack">
      <PendingChanges path={path} view={view} />
      {view.selection ? (
        <CommitPanel path={path} view={view} />
      ) : (
        <div className="right-empty dim">{t('right.selectCommit')}</div>
      )}
    </div>
  )
}

/** While another commit is shown, points the way back to uncommitted changes and the commit box. */
function PendingChanges({ path, view }: { path: string; view: RepoView }) {
  const t = useT()
  const { staged, unstaged, conflicted } = view.state!.status
  const count = staged.length + unstaged.length + conflicted.length
  if (!count) return null
  return (
    <button className="pending-bar" onClick={() => selectWip(path)}>
      <PencilLine size={14} />
      <span>{t('right.pending', { count })}</span>
      <span className="pending-action">{t('right.reviewCommit')} →</span>
    </button>
  )
}

function isActive(view: RepoView, source: Partial<DiffSource>): boolean {
  const d = view.diff?.source
  if (!d) return false
  return (
    d.kind === source.kind &&
    d.path === source.path &&
    (d.kind !== 'commit' || d.hash === (source as { hash?: string }).hash)
  )
}

function FileRow(props: {
  file: FileChange
  active: boolean
  onOpen: () => void
  onContext: (e: React.MouseEvent) => void
  action?: { label: string; run: () => void }
}) {
  const { dir, name } = splitPath(props.file.path)
  return (
    <div
      className={cx('file-row', props.active && 'active')}
      onClick={props.onOpen}
      onContextMenu={props.onContext}
      title={props.file.path}
    >
      <StatusBadge status={props.file.status} />
      <span className="file-path">
        <span className="file-dir">{dir}</span>
        <span className="file-name">{name}</span>
        {props.file.origPath && <span className="file-orig"> ← {props.file.origPath}</span>}
      </span>
      {props.action && (
        <button
          className="file-action"
          onClick={(e) => {
            e.stopPropagation()
            props.action!.run()
          }}
        >
          {props.action.label}
        </button>
      )}
    </div>
  )
}

function FileSection(props: {
  title: string
  count: number
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('file-section', props.className)}>
      <div className="file-section-header">
        <span>{props.title}</span>
        {props.count > 0 && props.action}
      </div>
      <div className="file-list">{props.children}</div>
    </div>
  )
}

function WorkingPanel({ path, view }: { path: string; view: RepoView }) {
  const t = useT()
  const state = view.state!
  const { staged, unstaged, conflicted } = state.status
  const total = staged.length + unstaged.length + conflicted.length
  const branch = state.head.branch ?? (state.head.hash ? shortHash(state.head.hash) : 'HEAD')

  return (
    <div className="right-content">
      <div className="panel-header">{t('wip.changes', { count: total, branch })}</div>
      {state.operation && (
        <div className="op-banner">
          <AlertTriangle size={16} />
          <div className="op-text">
            <strong>{t(`op.${state.operation}`)}</strong>
            <span>{conflicted.length ? t('op.conflictsHint') : t('op.readyHint')}</span>
          </div>
          <div className="op-actions">
            <button className="btn small" onClick={() => void abortOperation(path)}>
              {t('op.abort')}
            </button>
            <button
              className="btn small btn-primary"
              disabled={conflicted.length > 0}
              onClick={() => void continueOperation(path)}
            >
              {t('op.continue')}
            </button>
          </div>
        </div>
      )}
      <div className="file-sections">
        {conflicted.length > 0 && (
          <FileSection
            title={t('wip.conflicted', { count: conflicted.length })}
            count={conflicted.length}
            className="conflicts"
          >
            {conflicted.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                active={isActive(view, { kind: 'unstaged', path: file.path })}
                onOpen={() => void openDiff(path, { kind: 'unstaged', path: file.path, conflicted: true })}
                onContext={(e) => openMenu(e, fileMenu(path, file, 'conflicted'))}
                action={{ label: t('wip.markResolved'), run: () => void stageFiles(path, [file]) }}
              />
            ))}
          </FileSection>
        )}
        <FileSection
          title={t('wip.unstaged', { count: unstaged.length })}
          count={unstaged.length}
          action={
            <button className="btn small btn-stage" onClick={() => void stageAll(path)}>
              {t('wip.stageAll')}
            </button>
          }
        >
          {unstaged.length === 0 && <div className="file-empty dim">{t('wip.noChanges')}</div>}
          {unstaged.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              active={isActive(view, { kind: 'unstaged', path: file.path })}
              onOpen={() => void openDiff(path, { kind: 'unstaged', path: file.path, untracked: file.status === '?' })}
              onContext={(e) => openMenu(e, fileMenu(path, file, 'unstaged'))}
              action={{ label: t('wip.stage'), run: () => void stageFiles(path, [file]) }}
            />
          ))}
        </FileSection>
        <FileSection
          title={t('wip.staged', { count: staged.length })}
          count={staged.length}
          action={
            <button className="btn small btn-unstage" onClick={() => void unstageAll(path)}>
              {t('wip.unstageAll')}
            </button>
          }
        >
          {staged.length === 0 && <div className="file-empty dim">{t('wip.noChanges')}</div>}
          {staged.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              active={isActive(view, { kind: 'staged', path: file.path })}
              onOpen={() => void openDiff(path, { kind: 'staged', path: file.path })}
              onContext={(e) => openMenu(e, fileMenu(path, file, 'staged'))}
              action={{ label: t('wip.unstage'), run: () => void unstageFiles(path, [file]) }}
            />
          ))}
        </FileSection>
      </div>
      <CommitBox path={path} view={view} />
    </div>
  )
}

function CommitBox({ path, view }: { path: string; view: RepoView }) {
  const t = useT()
  const { summary, body, amend } = view.draft
  const status = view.state!.status
  const stagedCount = status.staged.length
  const blocked = status.conflicted.length > 0
  const canCommit = !!summary.trim() && (stagedCount > 0 || amend) && !blocked

  let label: string
  if (!summary.trim()) label = t('wip.typeSummary')
  else if (stagedCount > 0) label = t('wip.commitBtn', { count: stagedCount })
  else if (amend) label = t('wip.amend')
  else label = t('wip.stageToCommit')

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) {
      e.preventDefault()
      void commit(path)
    }
  }

  return (
    <div className="commit-box">
      <div className="commit-box-header">
        <span>{t('wip.commitTitle')}</span>
        <label className="checkbox">
          <input type="checkbox" checked={amend} onChange={(e) => void setAmend(path, e.target.checked)} />
          {t('wip.amend')}
        </label>
      </div>
      <div className="summary-wrap">
        <input
          className="summary-input"
          placeholder={t('wip.summary')}
          value={summary}
          spellCheck={false}
          onChange={(e) => updateDraft(path, { summary: e.target.value })}
          onKeyDown={onKey}
        />
        <span className={cx('summary-count', summary.length > 72 && 'over')}>{72 - summary.length}</span>
      </div>
      <textarea
        className="description-input"
        placeholder={t('wip.description')}
        value={body}
        rows={4}
        onChange={(e) => updateDraft(path, { body: e.target.value })}
        onKeyDown={onKey}
      />
      <button className="btn btn-commit" disabled={!canCommit} onClick={() => void commit(path)} title="Ctrl+Enter">
        {label}
      </button>
    </div>
  )
}

function CommitPanel({ path, view }: { path: string; view: RepoView }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const selection = view.selection!
  const hash = selection.kind === 'wip' ? '' : selection.hash
  const details = view.details?.commit.hash === hash ? view.details : null
  const stash = selection.kind === 'stash' ? view.state?.stashes.find((s) => s.hash === hash) : undefined

  if (!details) return <div className="right-empty dim">{t('graph.loading')}</div>
  const c = details.commit
  const [subject, ...bodyLines] = details.message.split('\n')
  const body = bodyLines.join('\n').trim()
  const parent = c.parents[0] ?? null

  return (
    <div className="right-content">
      <div className="panel-header commit-header">
        <span className="dim">{stash ? t('stash.title') : t('commit.commit')}:</span>
        <code>{shortHash(c.hash)}</code>
        <button
          className="icon-btn small"
          title={t('menu.copySha')}
          onClick={() => void copyText(c.hash, t('toast.copied'))}
        >
          <Copy size={13} />
        </button>
      </div>
      <div className="commit-scroll">
        {stash && (
          <div className="stash-actions">
            <button className="btn small" onClick={() => void applyStash(path, stash)}>
              {t('menu.stashApply')}
            </button>
            <button className="btn small btn-primary" onClick={() => void popStash(path, stash)}>
              {t('menu.stashPop')}
            </button>
            <button className="btn small btn-danger" onClick={() => void dropStash(path, stash)}>
              {t('menu.stashDrop')}
            </button>
          </div>
        )}
        <div className="commit-message">
          <div className="commit-subject">{subject}</div>
          {body && <pre className="commit-body">{body}</pre>}
        </div>
        <div className="commit-meta">
          <div className="commit-author">
            <Avatar name={c.authorName} email={c.authorEmail} size={32} />
            <div>
              <div>{c.authorName}</div>
              <div className="dim small">{t('commit.authored', { date: formatDate(c.authorDate, lang) })}</div>
            </div>
          </div>
          {(c.committerName !== c.authorName || c.committerEmail !== c.authorEmail) && (
            <div className="dim small">{t('commit.committedBy', { name: c.committerName })}</div>
          )}
          {c.parents.length > 0 && (
            <div className="commit-parents small">
              <span className="dim">{t('commit.parents')}:</span>
              {c.parents.map((p) => (
                <a key={p} onClick={() => void selectCommit(path, p, true)}>
                  {shortHash(p)}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="file-section-header">
          <span>{t('commit.files', { count: details.files.length })}</span>
        </div>
        <div className="file-list static">
          {details.files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              active={isActive(view, { kind: 'commit', path: file.path, hash: c.hash } as Partial<DiffSource>)}
              onOpen={() =>
                void openDiff(path, { kind: 'commit', hash: c.hash, parent, path: file.path, oldPath: file.origPath })
              }
              onContext={(e) => openMenu(e, fileMenu(path, file, 'commit'))}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
