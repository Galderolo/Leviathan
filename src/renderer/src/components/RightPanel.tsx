import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AlertTriangle, Copy, Lock, PencilLine } from 'lucide-react'
import { lfsPatternFor, type LfsLock } from '../../../shared/lfs'
import type { DiffSource, FileChange } from '../../../shared/types'
import {
  abortOperation,
  applyStash,
  commit,
  continueOperation,
  discardFiles,
  dropStash,
  moveToLfs,
  restageLfs,
  saveSettings,
  openDiff,
  openExternal,
  popStash,
  selectCommit,
  selectWip,
  setAmend,
  setupLfs,
  stageAll,
  stageFiles,
  unstageAll,
  unstageFiles,
  updateDraft,
  LFS_DOWNLOAD_URL
} from '../actions'
import {
  clickSelection,
  emptySelection,
  focusSelection,
  pruneSelection,
  splitRatio,
  toggleAll,
  type FileSelection
} from '../fileSelection'
import { useT } from '../i18n'
import { formatSize, lockFor, lockedByOthers } from '../lfsView'
import { pushAfterCommitTarget } from '../pushTarget'
import { fileMenu, filesMenu } from '../menus'
import { useRepo, useStore, type RepoView } from '../store'
import { copyText, openMenu } from '../ui'
import { cx, formatDate, shortHash, splitPath } from '../utils'
import { Avatar, LockIcon, StatusBadge } from './common'
import { FILE_ROW_HEIGHT, VirtualRows } from './VirtualRows'

export function RightPanel({ path }: { path: string }) {
  const view = useRepo(path)
  const t = useT()
  if (!view?.state) return <div className="right-empty dim">{t('graph.loading')}</div>
  if (view.selection?.kind === 'wip') return <WorkingPanel path={path} />
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

function isActive(diff: RepoView['diff'], source: Partial<DiffSource>): boolean {
  const d = diff?.source
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
  /** In a list where several files can be selected: Ctrl/Shift clicks and the checkbox change the selection. */
  select?: { checked: boolean; click: (e: React.MouseEvent, fromCheckbox: boolean) => void }
  /** The file goes through Git LFS. */
  lfs?: boolean
  lock?: LfsLock | null
}) {
  const { dir, name } = splitPath(props.file.path)
  const select = props.select
  return (
    <div
      className={cx('file-row', props.active && 'active', select?.checked && 'selected')}
      onClick={(e) => {
        if (select && (e.shiftKey || e.ctrlKey || e.metaKey)) select.click(e, false)
        else {
          select?.click(e, false)
          props.onOpen()
        }
      }}
      onContextMenu={props.onContext}
      title={props.file.path}
    >
      {select && (
        <input
          type="checkbox"
          className="file-check"
          tabIndex={-1}
          aria-label={props.file.path}
          checked={select.checked}
          onMouseDown={(e) => e.preventDefault()}
          onChange={() => {}}
          onClick={(e) => {
            e.stopPropagation()
            select.click(e, true)
          }}
        />
      )}
      <StatusBadge status={props.file.status} />
      <span className="file-path">
        <span className="file-dir">{dir}</span>
        <span className="file-name">{name}</span>
        {props.file.origPath && <span className="file-orig"> ← {props.file.origPath}</span>}
      </span>
      {props.lfs && <LfsTag />}
      {props.lock && <LockIcon lock={props.lock} />}
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

function LfsTag() {
  const t = useT()
  return (
    <span className="lfs-tag" title={t('lfs.tag')}>
      LFS
    </span>
  )
}

function FileSection(props: {
  title: string
  count: number
  action?: ReactNode
  children: ReactNode
  className?: string
  style?: CSSProperties
  sectionRef?: Ref<HTMLDivElement>
  /** Checkbox that selects every file of the list (or none). */
  selectAll?: { all: boolean; some: boolean; toggle: () => void; title: string }
}) {
  const selectAll = props.selectAll
  return (
    <div className={cx('file-section', props.className)} style={props.style} ref={props.sectionRef}>
      <div className="file-section-header">
        <span className="file-section-title">
          {selectAll && props.count > 0 && (
            <input
              type="checkbox"
              className="file-check"
              title={selectAll.title}
              checked={selectAll.all}
              ref={(el) => {
                if (el) el.indeterminate = selectAll.some && !selectAll.all
              }}
              onChange={selectAll.toggle}
            />
          )}
          {props.title}
        </span>
        {props.count > 0 && <span className="file-section-actions">{props.action}</span>}
      </div>
      <div className="file-list">{props.children}</div>
    </div>
  )
}

/** Selection state of one file list: Ctrl/Shift clicks, checkboxes and "select all". */
function useFileSelection(files: FileChange[]) {
  const order = files.map((f) => f.path)
  const [state, setState] = useState<FileSelection>(emptySelection)
  const selection = pruneSelection(state, order)
  // Files that left the list (staged, discarded...) are forgotten for good: if they come back, unchecked.
  useEffect(() => {
    if (selection !== state) setState(selection)
  }, [selection, state])
  const selected = files.filter((f) => selection.paths.has(f.path))
  return {
    selected,
    has: (file: FileChange) => selection.paths.has(file.path),
    // A plain click on the row only opens the file; the checkbox, Ctrl and Shift change the selection.
    click: (file: FileChange, e: React.MouseEvent, fromCheckbox: boolean) =>
      setState(
        !fromCheckbox && !e.shiftKey && !e.ctrlKey && !e.metaKey
          ? focusSelection(selection, file.path)
          : clickSelection(selection, order, file.path, {
              shift: e.shiftKey,
              toggle: fromCheckbox || e.ctrlKey || e.metaKey
            })
      ),
    all: files.length > 0 && selected.length === files.length,
    some: selected.length > 0,
    toggleAll: () => setState(toggleAll(selection, order)),
    clear: () => setState(emptySelection())
  }
}

const SPLIT_KEY = 'leviathan.unstagedShare'

function readSplit(): number {
  try {
    return splitRatio(Number(localStorage.getItem(SPLIT_KEY) ?? 0.5))
  } catch {
    return 0.5
  }
}

/**
 * The working tree lists. They hold thousands of entries after a big import, so they only subscribe to what they show:
 * typing the commit message (in `CommitBox`) must not go through them on every key.
 */
const WorkingPanel = memo(function WorkingPanel({ path }: { path: string }) {
  const t = useT()
  const view = useStore(
    useShallow((s) => {
      const r = s.repos[path]
      return { state: r?.state ?? null, diff: r?.diff ?? null, lfs: r?.lfs ?? null }
    })
  )
  const state = view.state!
  const { staged, unstaged, conflicted } = state.status
  const total = staged.length + unstaged.length + conflicted.length
  const branch = state.head.branch ?? (state.head.hash ? shortHash(state.head.hash) : 'HEAD')
  const unstagedSel = useFileSelection(unstaged)
  const stagedSel = useFileSelection(staged)
  const lfsFiles = new Set(state.lfsFiles)
  const locks = view.lfs?.locks

  // Draggable divider between the unstaged and staged lists; the share is remembered.
  const [split, setSplit] = useState(readSplit)
  const unstagedRef = useRef<HTMLDivElement>(null)
  const stagedRef = useRef<HTMLDivElement>(null)
  const dragSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    const top = unstagedRef.current?.getBoundingClientRect().top
    const bottom = stagedRef.current?.getBoundingClientRect().bottom
    if (top === undefined || bottom === undefined || bottom <= top) return
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    let latest = split
    const move = (ev: PointerEvent) => {
      latest = splitRatio((ev.clientY - top) / (bottom - top))
      setSplit(latest)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(SPLIT_KEY, String(latest))
      } catch {
        // not critical: the divider goes back to the middle next time
      }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

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
            <VirtualRows
              items={conflicted}
              rowHeight={FILE_ROW_HEIGHT}
              render={(file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  active={isActive(view.diff, { kind: 'unstaged', path: file.path })}
                  onOpen={() => void openDiff(path, { kind: 'unstaged', path: file.path, conflicted: true })}
                  onContext={(e) => openMenu(e, fileMenu(path, file, 'conflicted'))}
                  action={{ label: t('wip.markResolved'), run: () => void stageFiles(path, [file]) }}
                />
              )}
            />
          </FileSection>
        )}
        <FileSection
          title={t('wip.unstaged', { count: unstaged.length })}
          count={unstaged.length}
          style={{ flex: `${split} 1 0` }}
          sectionRef={unstagedRef}
          selectAll={{
            all: unstagedSel.all,
            some: unstagedSel.some,
            toggle: unstagedSel.toggleAll,
            title: t('wip.selectAll')
          }}
          action={
            unstagedSel.some ? (
              <>
                <button
                  className="btn small btn-danger-ghost"
                  onClick={() => void discardFiles(path, unstagedSel.selected).then((ok) => ok && unstagedSel.clear())}
                >
                  {t('wip.discardSelected', { count: unstagedSel.selected.length })}
                </button>
                <button
                  className="btn small btn-stage"
                  onClick={() => void stageFiles(path, unstagedSel.selected).then((ok) => ok && unstagedSel.clear())}
                >
                  {t('wip.stageSelected', { count: unstagedSel.selected.length })}
                </button>
              </>
            ) : (
              <button className="btn small btn-stage" onClick={() => void stageAll(path)}>
                {t('wip.stageAll')}
              </button>
            )
          }
        >
          {unstaged.length === 0 && <div className="file-empty dim">{t('wip.noChanges')}</div>}
          <VirtualRows
            items={unstaged}
            rowHeight={FILE_ROW_HEIGHT}
            render={(file) => (
              <FileRow
                key={file.path}
                file={file}
                active={isActive(view.diff, { kind: 'unstaged', path: file.path })}
                onOpen={() =>
                  void openDiff(path, { kind: 'unstaged', path: file.path, untracked: file.status === '?' })
                }
                onContext={(e) =>
                  openMenu(
                    e,
                    unstagedSel.has(file) && unstagedSel.selected.length > 1
                      ? filesMenu(path, unstagedSel.selected, 'unstaged')
                      : fileMenu(path, file, 'unstaged')
                  )
                }
                action={{ label: t('wip.stage'), run: () => void stageFiles(path, [file]) }}
                lfs={lfsFiles.has(file.path)}
                lock={lockFor(locks, file.path)}
                select={{ checked: unstagedSel.has(file), click: (e, box) => unstagedSel.click(file, e, box) }}
              />
            )}
          />
        </FileSection>
        <div className="split-handle" onPointerDown={dragSplit} title={t('wip.resize')} />
        <FileSection
          title={t('wip.staged', { count: staged.length })}
          count={staged.length}
          style={{ flex: `${1 - split} 1 0` }}
          sectionRef={stagedRef}
          selectAll={{
            all: stagedSel.all,
            some: stagedSel.some,
            toggle: stagedSel.toggleAll,
            title: t('wip.selectAll')
          }}
          action={
            stagedSel.some ? (
              <button
                className="btn small btn-unstage"
                onClick={() => void unstageFiles(path, stagedSel.selected).then((ok) => ok && stagedSel.clear())}
              >
                {t('wip.unstageSelected', { count: stagedSel.selected.length })}
              </button>
            ) : (
              <button className="btn small btn-unstage" onClick={() => void unstageAll(path)}>
                {t('wip.unstageAll')}
              </button>
            )
          }
        >
          {staged.length === 0 && <div className="file-empty dim">{t('wip.noChanges')}</div>}
          <VirtualRows
            items={staged}
            rowHeight={FILE_ROW_HEIGHT}
            render={(file) => (
              <FileRow
                key={file.path}
                file={file}
                active={isActive(view.diff, { kind: 'staged', path: file.path })}
                onOpen={() => void openDiff(path, { kind: 'staged', path: file.path })}
                onContext={(e) =>
                  openMenu(
                    e,
                    stagedSel.has(file) && stagedSel.selected.length > 1
                      ? filesMenu(path, stagedSel.selected, 'staged')
                      : fileMenu(path, file, 'staged')
                  )
                }
                action={{ label: t('wip.unstage'), run: () => void unstageFiles(path, [file]) }}
                lfs={lfsFiles.has(file.path)}
                lock={lockFor(locks, file.path)}
                select={{ checked: stagedSel.has(file), click: (e, box) => stagedSel.click(file, e, box) }}
              />
            )}
          />
        </FileSection>
      </div>
      <CommitBox path={path} />
    </div>
  )
})

function CommitBox({ path }: { path: string }) {
  const t = useT()
  const view = useRepo(path)!
  const { summary, body, amend } = view.draft
  const status = view.state!.status
  const pushAfter = useStore((s) => s.settings.pushAfterCommit)
  const pushTarget = pushAfterCommitTarget(view.state!.head, view.state!.remotes)
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
      {pushTarget && (
        <label className="checkbox push-after" title={t('wip.pushAfterCommitHint')}>
          <input
            type="checkbox"
            checked={pushAfter}
            onChange={(e) => void saveSettings({ pushAfterCommit: e.target.checked })}
          />
          {t('wip.pushAfterCommit', { target: pushTarget })}
        </label>
      )}
      <LfsWarnings path={path} view={view} />
      <button className="btn btn-commit" disabled={!canCommit} onClick={() => void commit(path)} title="Ctrl+Enter">
        {label}
      </button>
    </div>
  )
}

/** Files about to be committed outside LFS (too big, or meant for LFS), and changed files someone else locked. */
function LfsWarnings({ path, view }: { path: string; view: RepoView }) {
  const t = useT()
  const [running, setRunning] = useState(false)
  const state = view.state!
  const info = view.lfs?.info
  const large = state.largeFiles
  const plain = state.unconvertedLfs
  const changed = [...state.status.staged, ...state.status.unstaged].map((f) => f.path)
  const locked = lockedByOthers(view.lfs?.locks ?? [], changed)
  if (!large.length && !plain.length && !locked.length) return null

  const run = (action: () => Promise<void>) => {
    setRunning(true)
    void action().finally(() => setRunning(false))
  }
  // What fixes it: git-lfs first, then its setup, then the action itself.
  const fix = (label: string, action: () => Promise<void>): ReactNode => {
    if (!info) return null
    if (!info.version) {
      return (
        <button className="btn small" onClick={() => openExternal(LFS_DOWNLOAD_URL)}>
          {t('lfs.install')}
        </button>
      )
    }
    const setup = !info.filters
    return (
      <button
        className={cx('btn small', !setup && 'btn-primary')}
        disabled={running || !!view.busy}
        onClick={() => run(setup ? () => setupLfs(path) : action)}
      >
        {setup ? t('lfs.setup') : label}
      </button>
    )
  }
  const fileList = (files: { path: string; size: number }[]) => (
    <ul>
      {files.slice(0, 4).map((f) => (
        <li key={f.path} title={f.path}>
          {f.path} <span className="dim">({formatSize(f.size)})</span>
        </li>
      ))}
      {files.length > 4 && <li className="dim">…</li>}
    </ul>
  )
  const patterns = [...new Set(large.map((f) => lfsPatternFor(f.path)))].join(', ')

  return (
    <>
      {plain.length > 0 && (
        <div className="commit-warning">
          <AlertTriangle size={14} />
          <div className="commit-warning-body">
            <span>{t('lfs.plainFiles', { count: plain.length })}</span>
            {fileList(plain)}
            {fix(t('lfs.restage'), () =>
              restageLfs(
                path,
                plain.map((f) => f.path)
              )
            )}
          </div>
        </div>
      )}
      {large.length > 0 && (
        <div className="commit-warning">
          <AlertTriangle size={14} />
          <div className="commit-warning-body">
            <span>{t('lfs.largeFiles', { count: large.length })}</span>
            {fileList(large)}
            {fix(t('lfs.moveTo', { patterns }), () =>
              moveToLfs(
                path,
                large.map((f) => f.path)
              )
            )}
          </div>
        </div>
      )}
      {locked.length > 0 && (
        <div className="commit-warning danger">
          <Lock size={14} />
          <div className="commit-warning-body">
            <span>{t('lfs.lockedByOthers', { count: locked.length })}</span>
            <ul>
              {locked.slice(0, 4).map((l) => (
                <li key={l.path} title={l.path}>
                  {l.path} <span className="dim">— {l.owner}</span>
                </li>
              ))}
              {locked.length > 4 && <li className="dim">…</li>}
            </ul>
          </div>
        </div>
      )}
    </>
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
          <VirtualRows
            items={details.files}
            rowHeight={FILE_ROW_HEIGHT}
            render={(file) => (
              <FileRow
                key={file.path}
                file={file}
                active={isActive(view.diff, { kind: 'commit', path: file.path, hash: c.hash } as Partial<DiffSource>)}
                onOpen={() =>
                  void openDiff(path, {
                    kind: 'commit',
                    hash: c.hash,
                    parent,
                    path: file.path,
                    oldPath: file.origPath,
                    // Only a stash lists untracked files: they come from its third parent.
                    untracked: file.status === '?' || undefined
                  })
                }
                onContext={(e) => openMenu(e, fileMenu(path, file, 'commit', c.hash))}
                lock={lockFor(view.lfs?.locks, file.path)}
              />
            )}
          />
        </div>
      </div>
    </div>
  )
}
