import type { ComponentType } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  RefreshCw,
  Redo2,
  Undo2,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  GitBranchPlus,
  Search,
  Settings,
  SquareTerminal,
  X
} from 'lucide-react'
import type { PullMode } from '../../../shared/types'
import {
  closeTab,
  createBranch,
  fetchAll,
  openInFileManager,
  openInEditor,
  openTerminal,
  popStash,
  pull,
  push,
  selectCommit,
  setFilter,
  stashChanges,
  checkoutRef,
  chooseRepoAccount,
  redo,
  undo
} from '../actions'
import { useT } from '../i18n'
import { pushCount } from '../pushTarget'
import { getRepo, useRepo, useStore, type MenuItem } from '../store'
import { openMenuBelow } from '../ui'
import { basename, cx, matchesFilter, shortHash } from '../utils'
import { Spinner } from './common'

function jumpToMatch(path: string, backwards: boolean): void {
  const view = getRepo(path)
  if (!view || !view.filter.trim()) return
  const commits = view.commits
  const sel = view.selection
  const current = sel && sel.kind !== 'wip' ? commits.findIndex((c) => c.hash === sel.hash) : -1
  const n = commits.length
  for (let step = 1; step <= n; step++) {
    const i = (((backwards ? current - step : current + step) % n) + n) % n
    if (matchesFilter(commits[i], view.filter)) {
      void selectCommit(path, commits[i].hash, true)
      return
    }
  }
}

interface ToolButtonProps {
  icon: ComponentType<{ size?: number }>
  label: string
  onClick: () => void
  onCaret?: (e: React.MouseEvent) => void
  busy?: boolean
  disabled?: boolean
  badge?: string
  title?: string
}

function ToolButton({ icon: Icon, label, onClick, onCaret, busy, disabled, badge, title }: ToolButtonProps) {
  return (
    <div className={cx('tool-button', disabled && 'disabled')} title={title}>
      <button className="tool-main" onClick={onClick} disabled={disabled}>
        <span className="tool-icon">
          {busy ? <Spinner size={18} /> : <Icon size={20} />}
          {badge && <span className="tool-badge">{badge}</span>}
        </span>
        <span className="tool-label">{label}</span>
      </button>
      {onCaret && (
        <button className="tool-caret" onClick={onCaret} disabled={disabled}>
          <ChevronDown size={12} />
        </button>
      )}
    </div>
  )
}

export function Toolbar({ path }: { path: string }) {
  const view = useRepo(path)
  const t = useT()
  const pullMode = useStore((s) => s.settings.pullMode)
  const state = view?.state
  const head = state?.head
  const toPush = state ? pushCount(state) : 0
  const busy = view?.busy ?? null
  const remoteBusy = busy !== null
  const lastUndo = view?.undo[view.undo.length - 1]
  const lastRedo = view?.redo[view.redo.length - 1]

  const pullLabels: Record<PullMode, string> = {
    ff: t('pull.ff'),
    'ff-only': t('pull.ffOnly'),
    rebase: t('pull.rebase')
  }

  const pullMenu = (e: React.MouseEvent) =>
    openMenuBelow(e, [
      { label: t('pull.fetchAll'), onClick: () => void fetchAll(path) },
      { separator: true },
      ...(['ff', 'ff-only', 'rebase'] as PullMode[]).map((mode) => ({
        label: pullLabels[mode],
        hint: mode === pullMode ? '✓' : undefined,
        onClick: () => void pull(path, mode)
      }))
    ])

  const pushMenu = (e: React.MouseEvent) =>
    openMenuBelow(e, [
      { label: t('toolbar.push'), onClick: () => void push(path) },
      { label: t('menu.forcePush'), danger: true, onClick: () => void push(path, { force: true }) }
    ])

  const repoMenu = (e: React.MouseEvent) =>
    openMenuBelow(e, [
      { label: t('menu.repoAccount'), onClick: () => void chooseRepoAccount(path) },
      { separator: true },
      ...(useStore.getState().settings.editor.trim()
        ? [{ label: t('tools.openInEditor'), onClick: () => openInEditor(path, null) }]
        : []),
      { label: t('menu.openFolder'), onClick: () => openInFileManager(path) },
      { label: t('toolbar.terminal'), onClick: () => openTerminal(path) },
      { separator: true },
      { label: t('tab.close'), onClick: () => closeTab(path) }
    ])

  const branchMenu = (e: React.MouseEvent) => {
    const locals = (state?.refs ?? []).filter((r) => r.type === 'head')
    const items: MenuItem[] = locals.map((ref) => ({
      label: ref.name,
      hint: ref.isHead ? '✓' : undefined,
      disabled: ref.isHead,
      onClick: () => void checkoutRef(path, ref)
    }))
    if (!items.length) items.push({ label: t('left.empty'), disabled: true, onClick: () => {} })
    openMenuBelow(e, items)
  }

  const branchLabel = head
    ? head.detached
      ? `${t('toolbar.detached')} ${head.hash ? shortHash(head.hash) : ''}`
      : (head.branch ?? '')
    : '…'

  return (
    <div className="toolbar">
      <div className="toolbar-repo">
        <button className="toolbar-field" onClick={repoMenu}>
          <span className="field-label">{t('toolbar.repository')}</span>
          <span className="field-value">
            {basename(path)} <ChevronDown size={12} />
          </span>
          {view?.account && (
            <span className="field-account" title={`${view.account.name} <${view.account.email}>`}>
              {view.account.username}@{view.account.host}
            </span>
          )}
        </button>
        <ChevronRight size={14} className="dim" />
        <button className="toolbar-field" onClick={branchMenu}>
          <span className="field-label">{t('toolbar.branch')}</span>
          <span className="field-value">
            {branchLabel} <ChevronDown size={12} />
          </span>
        </button>
      </div>

      <div className="toolbar-actions">
        <ToolButton
          icon={Undo2}
          label={t('toolbar.undo')}
          title={lastUndo ? t('toolbar.undoHint', { label: lastUndo.label }) : t('toast.nothingToUndo')}
          onClick={() => void undo(path)}
          disabled={!lastUndo || remoteBusy}
        />
        <ToolButton
          icon={Redo2}
          label={t('toolbar.redo')}
          title={lastRedo ? t('toolbar.redoHint', { label: lastRedo.label }) : t('toast.nothingToRedo')}
          onClick={() => void redo(path)}
          disabled={!lastRedo || remoteBusy}
        />
        <div className="toolbar-sep" />
        <ToolButton
          icon={RefreshCw}
          label={t('toolbar.fetch')}
          title={t('pull.fetchAll')}
          onClick={() => void fetchAll(path)}
          busy={busy === 'fetch'}
          disabled={remoteBusy}
        />
        <ToolButton
          icon={ArrowDownToLine}
          label={t('toolbar.pull')}
          title={pullLabels[pullMode]}
          onClick={() => void pull(path)}
          onCaret={pullMenu}
          busy={busy === 'pull'}
          disabled={remoteBusy}
          badge={head?.behind ? String(head.behind) : undefined}
        />
        <ToolButton
          icon={ArrowUpToLine}
          label={t('toolbar.push')}
          onClick={() => void push(path)}
          onCaret={pushMenu}
          busy={busy === 'push'}
          disabled={remoteBusy}
          badge={toPush ? String(toPush) : undefined}
        />
        <div className="toolbar-sep" />
        <ToolButton icon={GitBranchPlus} label={t('toolbar.branchBtn')} onClick={() => void createBranch(path, null)} />
        <ToolButton
          icon={Archive}
          label={t('toolbar.stash')}
          onClick={() => void stashChanges(path)}
          onCaret={(e) =>
            openMenuBelow(e, [{ label: t('menu.stashWithMessage'), onClick: () => void stashChanges(path, true) }])
          }
        />
        <ToolButton icon={ArchiveRestore} label={t('toolbar.pop')} onClick={() => void popStash(path)} />
        <div className="toolbar-sep" />
        <ToolButton icon={SquareTerminal} label={t('toolbar.terminal')} onClick={() => openTerminal(path)} />
      </div>

      <div className="toolbar-right">
        <div className="search-box">
          <Search size={14} />
          <input
            id="graph-search"
            placeholder={t('toolbar.search')}
            value={view?.filter ?? ''}
            spellCheck={false}
            onChange={(e) => setFilter(path, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') jumpToMatch(path, e.shiftKey)
              if (e.key === 'Escape') {
                setFilter(path, '')
                e.currentTarget.blur()
              }
            }}
          />
          {view?.filter && (
            <button
              className="search-clear"
              title={t('toolbar.clearSearch')}
              // Keeps the focus in the box, ready for the next search.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFilter(path, '')}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          className="icon-btn"
          title={t('settings.title')}
          onClick={() => useStore.setState({ settingsOpen: true })}
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  )
}
