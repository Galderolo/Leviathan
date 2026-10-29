import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { pullRequestsByRef } from '../graphFocus'
import {
  Archive,
  Box,
  Boxes,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  EyeOff,
  Folder,
  GitBranch,
  GitPullRequest,
  GitPullRequestDraft,
  HardDrive,
  Laptop,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Tag,
  X
} from 'lucide-react'
import type { GitRef, Stash } from '../../../shared/types'
import { canInstall } from '../../../shared/lfsInstall'
import {
  LFS_DOWNLOAD_URL,
  addRemote,
  checkoutPullRequest,
  checkoutRef,
  copyLfsCommand,
  installGitLfs,
  loadLfsLocks,
  openExternal,
  openSubmodule,
  selectRef,
  selectStash,
  setupLfs,
  trackLfsPattern,
  updateSubmodules
} from '../actions'
import { useT } from '../i18n'
import { readCollapsed, writeCollapsed, type Collapsed } from '../sidePanelState'
import { patternLabel } from '../lfsView'
import {
  branchMenu,
  lfsPatternMenu,
  lockMenu,
  pullRequestMenu,
  remoteMenu,
  stashMenu,
  submoduleMenu,
  tagMenu
} from '../menus'
import { useStore } from '../store'
import { openMenu } from '../ui'
import { buildTree, cx, formatDate, relativeDate, shortHash, visibleTreeRows, type TreeNode } from '../utils'
import { VirtualRows } from './VirtualRows'
import { LockIcon } from './common'
import { refDragProps, refDropProps } from './refDnd'

export function LeftPanel({ path }: { path: string }) {
  // Only what the panel shows: typing a commit message must not redraw thousands of branches.
  const view = useStore(
    useShallow((s) => {
      const r = s.repos[path]
      return {
        state: r?.state,
        pullRequests: r?.pullRequests,
        graphScope: r?.graphScope,
        selection: r?.selection,
        lfs: r?.lfs,
        submodules: r?.submodules,
        busy: r?.busy
      }
    })
  )
  const t = useT()
  const lang = useStore((s) => s.lang)
  const lfsOffer = useStore((s) => s.lfsOffer)
  const lfsInstalling = useStore((s) => s.lfsInstalling)
  const [filter, setFilter] = useState('')
  // Remembered per repository: switching tabs (or restarting) keeps folders as the user left them.
  const [collapsed, setCollapsed] = useState<Collapsed>(() => readCollapsed(path))
  const [collapsedFor, setCollapsedFor] = useState(path)
  if (collapsedFor !== path) {
    setCollapsedFor(path)
    setCollapsed(readCollapsed(path))
  }
  const toggle = (key: string) => {
    const next = { ...collapsed, [key]: !collapsed[key] }
    setCollapsed(next)
    writeCollapsed(path, next)
  }

  const state = view?.state
  const f = filter.trim().toLowerCase()
  const match = (name: string) => !f || name.toLowerCase().includes(f)
  const refs = state?.refs ?? []
  const locals = refs.filter((r) => r.type === 'head' && match(r.name))
  const remoteRefs = refs.filter((r) => r.type === 'remote' && match(r.name))
  const tags = refs.filter((r) => r.type === 'tag' && match(r.name))
  const stashes = (state?.stashes ?? []).filter((s) => match(s.message))
  const remotes = state?.remotes ?? []
  const prs = view?.pullRequests
  const prItems = (prs?.items ?? []).filter((p) => match('#' + p.number + ' ' + p.title + ' ' + p.sourceBranch))
  const prByRef = useMemo(() => pullRequestsByRef(prs?.items ?? [], prs?.remote ?? null, refs), [prs, refs])
  // The account's token no longer works (revoked, expired) or cannot be read here: say what to do about it.
  const tokenProblem = !prs?.error
    ? null
    : /rejected the token/.test(prs.error)
      ? 'left.tokenRejected'
      : /can no longer be read/.test(prs.error)
        ? 'left.tokenUnreadable'
        : null
  const submodules = (view.submodules ?? []).filter((s) => match(s.path))
  const staleSubs = (view.submodules ?? []).filter((s) => s.state === 'uninitialized' || s.state === 'outOfSync')
  const lfs = view?.lfs?.info.used ? view.lfs : null
  const locks = (lfs?.locks ?? []).filter((l) => match(l.path))
  const hiddenRefs = new Set(view?.graphScope.hidden ?? [])
  const selectedHash = view?.selection && view.selection.kind !== 'wip' ? view.selection.hash : null

  const branchRow = (ref: GitRef, name: string) => (
    <div
      className={cx(
        'side-row',
        ref.isHead && 'head',
        selectedHash === ref.hash && 'selected',
        hiddenRefs.has(ref.fullName) && 'hidden-in-graph'
      )}
      onClick={() => selectRef(path, ref)}
      onDoubleClick={() => void checkoutRef(path, ref)}
      {...refDragProps(ref)}
      {...refDropProps(path, ref)}
      onContextMenu={(e) => openMenu(e, ref.type === 'tag' ? tagMenu(path, ref) : branchMenu(path, ref))}
      title={ref.upstream ? `${ref.name} → ${ref.upstream}` : ref.name}
    >
      {ref.isHead ? (
        <Check size={13} className="head-icon" strokeWidth={3} />
      ) : ref.type === 'tag' ? (
        <Tag size={13} className="dim" />
      ) : (
        <GitBranch size={13} className="dim" />
      )}
      <span className="side-name">{name}</span>
      {prByRef.has(ref.fullName) && <span className="ref-pr">#{prByRef.get(ref.fullName)!.join(' #')}</span>}
      {hiddenRefs.has(ref.fullName) && <EyeOff size={12} className="dim" />}
      {!!ref.behind && (
        <span className="ab-badge behind">
          <ArrowDown size={10} strokeWidth={3} />
          {ref.behind}
        </span>
      )}
      {!!ref.ahead && (
        <span className="ab-badge ahead">
          <ArrowUp size={10} strokeWidth={3} />
          {ref.ahead}
        </span>
      )}
      {ref.upstreamGone && (
        <span className="ab-badge gone" title={t('left.upstreamGone', { upstream: ref.upstream ?? '' })}>
          <X size={10} strokeWidth={3} />
        </span>
      )}
      {ref.date !== undefined && (
        <span className="side-date" title={formatDate(ref.date, lang)}>
          {relativeDate(ref.date, lang)}
        </span>
      )}
    </div>
  )

  return (
    <div className="side-panel">
      <div className="side-filter">
        <Search size={13} />
        <input
          placeholder={t('left.filter')}
          value={filter}
          spellCheck={false}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
        />
        {filter && (
          <button
            className="search-clear"
            title={t('toolbar.clearSearch')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFilter('')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="side-scroll">
        <Section
          id="local"
          icon={<Laptop size={14} />}
          title={t('left.local')}
          count={locals.length}
          collapsed={collapsed}
          toggle={toggle}
        >
          <TreeView
            nodes={buildTree(locals, (r) => r.name)}
            prefix="local:"
            collapsed={collapsed}
            toggle={toggle}
            leaf={branchRow}
          />
        </Section>

        <Section
          id="remote"
          icon={<Cloud size={14} />}
          title={t('left.remote')}
          count={remoteRefs.length}
          collapsed={collapsed}
          toggle={toggle}
          action={
            <button
              className="icon-btn small"
              title={t('dlg.addRemote')}
              onClick={(e) => {
                e.stopPropagation()
                void addRemote(path)
              }}
            >
              <Plus size={14} />
            </button>
          }
        >
          {remotes.map((remote) => {
            const key = `remote:${remote.name}`
            const own = remoteRefs.filter((r) => r.remote === remote.name)
            return (
              <div key={remote.name}>
                <div
                  className="side-row folder"
                  onClick={() => toggle(key)}
                  onContextMenu={(e) => openMenu(e, remoteMenu(path, remote.name))}
                  title={remote.fetchUrl}
                >
                  {collapsed[key] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <Cloud size={13} className="dim" />
                  <span className="side-name">{remote.name}</span>
                  <span className="side-count">{own.length}</span>
                </div>
                {!collapsed[key] && (
                  <TreeView
                    nodes={buildTree(own, (r) => r.name.slice(remote.name.length + 1))}
                    prefix={`${key}/`}
                    depth={1}
                    collapsed={collapsed}
                    toggle={toggle}
                    leaf={branchRow}
                  />
                )}
              </div>
            )
          })}
        </Section>

        {prs && (
          <Section
            id="prs"
            icon={<GitPullRequest size={14} />}
            title={t('left.pullRequests')}
            count={prItems.length}
            collapsed={collapsed}
            toggle={toggle}
          >
            {tokenProblem ? (
              <div className="side-note error">
                {t(tokenProblem)}{' '}
                <a onClick={() => useStore.setState({ settingsOpen: true, settingsSection: 'accounts' })}>
                  {t('left.openAccounts')}
                </a>
              </div>
            ) : (
              prs.error && <div className="side-note error">{prs.error}</div>
            )}
            {!prs.error && !prItems.length && <div className="side-note">{t('left.noPullRequests')}</div>}
            {prItems.map((pr) => (
              <div
                key={pr.number}
                className="side-row pr-row"
                // Like a branch: a click shows it in the graph, a double click checks it out.
                onClick={() => {
                  const source = !pr.fromFork && refs.find((r) => r.name === `${prs.remote}/${pr.sourceBranch}`)
                  if (source) selectRef(path, source)
                }}
                onDoubleClick={() => void checkoutPullRequest(path, pr)}
                onContextMenu={(e) => openMenu(e, pullRequestMenu(path, pr))}
                title={
                  '#' +
                  pr.number +
                  ' ' +
                  pr.title +
                  '\n' +
                  pr.sourceBranch +
                  ' → ' +
                  pr.targetBranch +
                  ' · ' +
                  pr.author
                }
              >
                {pr.draft ? (
                  <GitPullRequestDraft size={13} className="dim" />
                ) : (
                  <GitPullRequest size={13} className="pr-icon" />
                )}
                <span className="pr-number">#{pr.number}</span>
                <span className="side-name">{pr.title}</span>
                <span className="pr-branches">
                  {pr.sourceBranch} → {pr.targetBranch}
                </span>
              </div>
            ))}
          </Section>
        )}

        {(view.submodules?.length ?? 0) > 0 && (
          <Section
            id="submodules"
            icon={<Boxes size={14} />}
            title={t('left.submodules')}
            count={submodules.length}
            collapsed={collapsed}
            toggle={toggle}
            action={
              staleSubs.length > 0 ? (
                <button
                  className="icon-btn small"
                  title={t('sub.updateAll')}
                  disabled={!!view.busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    void updateSubmodules(path, null)
                  }}
                >
                  <Download size={14} />
                </button>
              ) : undefined
            }
          >
            {staleSubs.length > 0 && (
              <div className="side-note warn">
                {t('sub.staleNote', { count: staleSubs.length })}{' '}
                <a className="side-link" onClick={() => !view.busy && void updateSubmodules(path, null)}>
                  {t('sub.updateAll')}
                </a>
              </div>
            )}
            {submodules.map((sub) => (
              <div
                key={sub.path}
                className="side-row sub-row"
                onDoubleClick={() => void openSubmodule(path, sub)}
                onContextMenu={(e) => openMenu(e, submoduleMenu(path, sub))}
                title={t('sub.tooltip', {
                  url: sub.url,
                  recorded: shortHash(sub.recorded),
                  current: sub.current ? shortHash(sub.current) : '—'
                })}
              >
                <Box size={13} className="dim" />
                <span className="side-name">{sub.path}</span>
                {sub.dirty && <span className="sub-tag dirty">{t('sub.dirty')}</span>}
                {sub.state !== 'clean' && <span className={cx('sub-tag', sub.state)}>{t(`sub.${sub.state}`)}</span>}
              </div>
            ))}
          </Section>
        )}

        {lfs && (
          <Section
            id="lfs"
            icon={<HardDrive size={14} />}
            title={t('left.lfs')}
            count={locks.length}
            collapsed={collapsed}
            toggle={toggle}
            action={
              lfs.info.version && (
                <button
                  className="icon-btn small"
                  title={t('lfs.track')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void trackLfsPattern(path)
                  }}
                >
                  <Plus size={14} />
                </button>
              )
            }
          >
            {!lfs.info.version ? (
              <div className="side-note error">
                {t('lfs.notInstalled')}{' '}
                {canInstall(lfsOffer) && (
                  <>
                    <a className="side-link" onClick={() => !lfsInstalling && !view?.busy && void installGitLfs(path)}>
                      {t('lfs.installNow')}
                    </a>
                    {' · '}
                  </>
                )}
                {lfsOffer?.method === 'command' && lfsOffer.command && (
                  <>
                    <a className="side-link" title={lfsOffer.command} onClick={() => void copyLfsCommand()}>
                      {t('lfs.copyCommand')}
                    </a>
                    {' · '}
                  </>
                )}
                <a className="side-link" onClick={() => openExternal(LFS_DOWNLOAD_URL)}>
                  {t('lfs.install')}
                </a>
              </div>
            ) : (
              (!lfs.info.filters || !lfs.info.hooks) && (
                <div className="side-note warn">
                  {t('lfs.notSetUp')}{' '}
                  <a className="side-link" onClick={() => !view?.busy && void setupLfs(path)}>
                    {t('lfs.setup')}
                  </a>
                </div>
              )
            )}
            <div className="side-subheader">{t('lfs.patterns')}</div>
            {lfs.info.patterns.map((p) => (
              <div
                key={p.source + '\n' + p.pattern}
                className="side-row lfs-row"
                onContextMenu={(e) => openMenu(e, lfsPatternMenu(path, p))}
                title={p.source}
              >
                <span className="side-name">{patternLabel(p)}</span>
                {p.lockable && <Lock size={11} className="dim" />}
              </div>
            ))}
            {lfs.info.version && (
              <>
                <div className="side-subheader">
                  <span>{t('lfs.locks')}</span>
                  {
                    <button
                      className="icon-btn small"
                      title={t('lfs.refreshLocks')}
                      disabled={lfs.locksLoading}
                      onClick={() => void loadLfsLocks(path, true)}
                    >
                      <RefreshCw size={12} className={cx(lfs.locksLoading && 'spin')} />
                    </button>
                  }
                </div>
                {lfs.locksError && <div className="side-note error">{lfs.locksError}</div>}
                {!lfs.locksError && lfs.locksUnsupported && (
                  <div className="side-note">{t('lfs.locksUnsupported')}</div>
                )}
                {!lfs.locksError && !lfs.locksUnsupported && !lfs.locksLoading && !locks.length && (
                  <div className="side-note">{t('lfs.noLocks')}</div>
                )}
                {!lfs.locksError && locks.length > 0 && !lfs.verified && (
                  <div className="side-note">{t('lfs.unverified')}</div>
                )}
                {locks.map((lock) => (
                  <div
                    key={lock.id}
                    className="side-row lfs-row"
                    onContextMenu={(e) => openMenu(e, lockMenu(path, lock))}
                    title={lock.path + '\n' + (lock.lockedAt ? formatDate(Date.parse(lock.lockedAt) / 1000, lang) : '')}
                  >
                    <LockIcon lock={lock} />
                    <span className="side-name">{lock.path}</span>
                    <span className="lock-owner">{lock.mine ? t('lfs.you') : lock.owner}</span>
                  </div>
                ))}
              </>
            )}
          </Section>
        )}

        <Section
          id="stashes"
          icon={<Archive size={14} />}
          title={t('left.stashes')}
          count={stashes.length}
          collapsed={collapsed}
          toggle={toggle}
        >
          {stashes.map((stash: Stash) => (
            <div
              key={stash.hash}
              className={cx('side-row', selectedHash === stash.hash && 'selected')}
              onClick={() => selectStash(path, stash)}
              onContextMenu={(e) => openMenu(e, stashMenu(path, stash))}
              title={stash.message}
            >
              <Archive size={13} className="dim" />
              <span className="side-name">{stash.message}</span>
            </div>
          ))}
        </Section>

        <Section
          id="tags"
          icon={<Tag size={14} />}
          title={t('left.tags')}
          count={tags.length}
          collapsed={collapsed}
          toggle={toggle}
        >
          <TreeView
            nodes={buildTree(tags, (r) => r.name)}
            prefix="tag:"
            collapsed={collapsed}
            toggle={toggle}
            leaf={branchRow}
          />
        </Section>
      </div>
    </div>
  )
}

function Section(props: {
  id: string
  icon: ReactNode
  title: string
  count: number
  collapsed: Collapsed
  toggle: (key: string) => void
  action?: ReactNode
  children: ReactNode
}) {
  const key = `section:${props.id}`
  const closed = props.collapsed[key]
  return (
    <div className="side-section">
      <div className="side-section-header" onClick={() => props.toggle(key)}>
        {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {props.icon}
        <span className="side-section-title">{props.title}</span>
        <span className="side-count">{props.count}</span>
        {props.action}
      </div>
      {!closed && <div className="side-section-body">{props.children}</div>}
    </div>
  )
}

/** Height of a `.side-row` in px; the CSS and the virtual lists must agree. */
const SIDE_ROW_HEIGHT = 24

/**
 * A folder tree of refs. Only the rows near the visible part of the panel are drawn: with thousands of branches
 * and tags, drawing them all made folding a section or typing in the filter take most of a second.
 */
function TreeView(props: {
  nodes: TreeNode<GitRef>[]
  prefix: string
  depth?: number
  collapsed: Collapsed
  toggle: (key: string) => void
  leaf: (ref: GitRef, name: string) => ReactNode
}) {
  const { nodes, prefix, collapsed, depth = 0 } = props
  const rows = useMemo(() => visibleTreeRows(nodes, prefix, collapsed, depth), [nodes, prefix, collapsed, depth])
  return (
    <VirtualRows
      items={rows}
      rowHeight={SIDE_ROW_HEIGHT}
      render={({ key, depth, node }) =>
        node.item ? (
          <div key={key} style={{ paddingLeft: depth * 14 }}>
            {props.leaf(node.item, node.name)}
          </div>
        ) : (
          <div
            key={key}
            className="side-row folder"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => props.toggle(key)}
          >
            {collapsed[key] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <Folder size={13} className="dim" />
            <span className="side-name">{node.name}</span>
          </div>
        )
      }
    />
  )
}
