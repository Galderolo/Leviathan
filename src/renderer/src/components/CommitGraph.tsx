import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Archive, ArrowUp, Check, Cloud, Laptop, Tag } from 'lucide-react'
import {
  buildGraphItems,
  GRAPH_PADDING,
  graphColumnWidth,
  LANE_WIDTH,
  layoutItems,
  WIP_HASH,
  type GraphItem,
  type GraphRow
} from '../../../shared/graph'
import { laneX, linePath, type GraphGeometry } from '../../../shared/graphPaths'
import { checkoutRef, clearHighlight, loadMore, selectCommit, selectWip, showAllInGraph } from '../actions'
import { ancestry, highlightTip, pullRequestsByRef } from '../graphFocus'
import { useT } from '../i18n'
import { commitMenu, refMenu, stashMenu, wipMenu } from '../menus'
import { useRepo, useStore } from '../store'
import { openMenu } from '../ui'
import { cx, formatDate, groupRefs, initials, laneColor, matchesFilter, shortHash, type RefLabel } from '../utils'
import { Avatar } from './common'
import { refDragProps, refDropProps } from './refDnd'

const ROW_H = 30
const NODE_R = 10
const GEOMETRY: GraphGeometry = { rowHeight: ROW_H, laneWidth: LANE_WIDTH, padding: GRAPH_PADDING, radius: 8 }
const OVERSCAN = 12

export function CommitGraph({ path }: { path: string }) {
  const view = useRepo(path)
  const lang = useStore((s) => s.lang)
  const t = useT()

  const state = view?.state ?? null
  const commits = view?.commits
  const stashes = state?.stashes
  const headHash = state?.head.hash ?? null
  const changeCount = state
    ? state.status.staged.length + state.status.unstaged.length + state.status.conflicted.length
    : 0
  const hasChanges = changeCount > 0

  const items = useMemo(
    () => buildGraphItems(commits ?? [], stashes ?? [], headHash, hasChanges),
    [commits, stashes, headHash, hasChanges]
  )
  const layout = useMemo(() => layoutItems(items), [items])
  const refMap = useMemo(() => groupRefs(state?.refs ?? []), [state?.refs])
  const graphWidth = graphColumnWidth(layout.maxWidth)
  const columns = `200px ${graphWidth}px minmax(140px, 1fr) minmax(90px, 150px) minmax(110px, 150px) 70px`

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN)

  const selection = view?.selection ?? null
  const selectedHash = selection ? (selection.kind === 'wip' ? WIP_HASH : selection.hash) : null
  const selectedIndex = selectedHash ? items.findIndex((it) => it.hash === selectedHash) : -1

  const ensureVisible = (index: number, center: boolean) => {
    const el = scrollRef.current
    if (!el || index < 0) return
    const top = index * ROW_H
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = center
        ? top - el.clientHeight / 2 + ROW_H / 2
        : top < el.scrollTop
          ? top
          : top + ROW_H - el.clientHeight
    }
  }

  // Scroll to the selection when asked (clicking a branch in the left panel, search...).
  const scrollNonce = view?.scrollNonce ?? 0
  useEffect(() => {
    if (scrollNonce) ensureVisible(selectedIndex, true)
  }, [scrollNonce, selectedIndex >= 0])

  // Infinite scroll.
  const requested = useRef(0)
  useEffect(() => {
    if (view?.hasMore && last >= items.length - 20 && requested.current !== items.length) {
      requested.current = items.length
      void loadMore(path)
    }
  }, [last, items.length, view?.hasMore, path])

  const filter = view?.filter ?? ''
  const commitsList = view?.commits
  const prList = view?.pullRequests
  const refList = view?.state?.refs
  const prs = useMemo(
    () => pullRequestsByRef(prList?.items ?? [], prList?.remote ?? null, refList ?? []),
    [prList, refList]
  )
  const scope = view?.graphScope
  const highlight = view?.highlight ?? null
  const tip = useMemo(() => highlightTip(highlight, refList ?? []), [highlight, refList])
  const inBranch = useMemo(() => (tip && commitsList ? ancestry(commitsList, tip) : null), [tip, commitsList])

  const selectItem = (item: GraphItem) => {
    clearHighlight(path)
    if (item.kind === 'wip') selectWip(path)
    else void selectCommit(path, item.hash)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!items.length) return
    let next = -1
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, selectedIndex + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, selectedIndex - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'PageDown') next = Math.min(items.length - 1, selectedIndex + Math.floor(height / ROW_H))
    else if (e.key === 'PageUp') next = Math.max(0, selectedIndex - Math.floor(height / ROW_H))
    if (next === -1) return
    e.preventDefault()
    selectItem(items[next])
    ensureVisible(next, false)
  }

  const onContext = (e: React.MouseEvent, item: GraphItem) => {
    selectItem(item)
    if (item.kind === 'wip') openMenu(e, wipMenu(path))
    else if (item.kind === 'stash') openMenu(e, stashMenu(path, item.stash))
    else openMenu(e, commitMenu(path, item.hash))
  }

  const unpushedList = view?.state?.unpushed
  const unpushed = useMemo(() => new Set(unpushedList ?? []), [unpushedList])

  const rows = []
  for (let i = first; i < last; i++) {
    const item = items[i]
    const row = layout.rows[i]
    rows.push(
      <GraphRowView
        key={item.hash}
        path={path}
        item={item}
        row={row}
        index={i}
        columns={columns}
        graphWidth={graphWidth}
        labels={refMap.get(item.hash)}
        prs={prs}
        selected={i === selectedIndex}
        dimmed={
          item.kind === 'commit' &&
          ((!!filter && !matchesFilter(item.commit, filter)) || (!!inBranch && !inBranch.has(item.hash)))
        }
        draft={item.kind === 'wip' ? (view?.draft.summary ?? '') : ''}
        changeCount={item.kind === 'wip' ? changeCount : 0}
        lang={lang}
        wipLabel={t('graph.wip')}
        unpushedTitle={item.kind === 'commit' && unpushed.has(item.hash) ? t('graph.unpushed') : null}
        onSelect={selectItem}
        onContext={onContext}
      />
    )
  }

  return (
    <div className="graph-view">
      {scope && (scope.solo || scope.hidden.length > 0) && (
        <div className="graph-scope">
          <span>
            {scope.solo
              ? t('graph.onlyBranch', { name: scope.solo.replace(/^refs\/(heads|remotes|tags)\//, '') })
              : scope.hidden.length === 1
                ? t('graph.hiddenBranch')
                : t('graph.hiddenBranches', { count: scope.hidden.length })}
          </span>
          <button className="btn tiny" onClick={() => showAllInGraph(path)}>
            {t('graph.showAll')}
          </button>
        </div>
      )}
      <div className="graph-header" style={{ gridTemplateColumns: columns }}>
        <div>{t('graph.branchTag')}</div>
        <div>{t('graph.graph')}</div>
        <div>{t('graph.message')}</div>
        <div>{t('graph.author')}</div>
        <div>{t('graph.date')}</div>
        <div>{t('graph.sha')}</div>
      </div>
      <div
        className="graph-scroll"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="graph-canvas" style={{ height: items.length * ROW_H }}>
          {rows}
        </div>
        {!items.length && (
          <div className="empty-state">
            {view?.loading ? t('graph.loading') : view?.error ? view.error : t('graph.empty')}
          </div>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  path: string
  item: GraphItem
  row: GraphRow
  index: number
  columns: string
  graphWidth: number
  labels: RefLabel[] | undefined
  /** Open pull requests by branch (full ref name). */
  prs: Map<string, number[]>
  selected: boolean
  dimmed: boolean
  draft: string
  changeCount: number
  lang: string
  wipLabel: string
  /** Set (as its tooltip) when the commit is not pushed yet. */
  unpushedTitle: string | null
  onSelect: (item: GraphItem) => void
  onContext: (e: React.MouseEvent, item: GraphItem) => void
}

const GraphRowView = memo(function GraphRowView(props: RowProps) {
  const { item, row, labels, selected, dimmed, path } = props
  const color = laneColor(row.color)
  const style = { top: props.index * ROW_H, gridTemplateColumns: props.columns, '--lane': color } as CSSProperties

  let message: React.ReactNode
  let author: React.ReactNode = null
  let date = ''
  let sha = ''
  if (item.kind === 'wip') {
    message = (
      <>
        <span className="wip-label">{props.wipLabel}</span>
        {props.draft && <span className="wip-draft">{props.draft}</span>}
        <span className="wip-count">{props.changeCount}</span>
      </>
    )
  } else if (item.kind === 'stash') {
    message = (
      <>
        <Archive size={13} className="stash-icon" />
        <span>{item.stash.message}</span>
      </>
    )
    date = formatDate(item.stash.date, props.lang)
    sha = shortHash(item.hash)
  } else {
    const c = item.commit
    message = <span className="ellipsis">{c.subject}</span>
    author = (
      <>
        <Avatar name={c.authorName} email={c.authorEmail} size={18} />
        <span className="ellipsis">{c.authorName}</span>
      </>
    )
    date = formatDate(c.authorDate, props.lang)
    sha = shortHash(c.hash)
  }

  return (
    <div
      className={cx('graph-row', selected && 'selected', dimmed && 'dimmed', `row-${item.kind}`)}
      style={style}
      onMouseDown={(e) => e.button === 0 && props.onSelect(item)}
      onContextMenu={(e) => props.onContext(e, item)}
    >
      <div className="cell refs-cell">
        {labels && <RefLabels path={path} labels={labels} color={color} prs={props.prs} />}
      </div>
      <div className="cell graph-cell">
        <GraphSvg row={row} item={item} width={props.graphWidth} connector={!!labels} />
      </div>
      <div className="cell msg-cell">
        {message}
        {props.unpushedTitle && (
          <span className="unpushed" title={props.unpushedTitle}>
            <ArrowUp size={11} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="cell author-cell">{author}</div>
      <div className="cell date-cell">{date}</div>
      <div className="cell sha-cell">{sha}</div>
    </div>
  )
})

function RefLabels(props: { path: string; labels: RefLabel[]; color: string; prs: Map<string, number[]> }) {
  const { path, labels, color, prs } = props
  const [first, ...rest] = labels
  return (
    <div className="ref-labels">
      <RefPill path={path} label={first} color={color} prs={prs} />
      {rest.length > 0 && (
        <div className="ref-more">
          <span className="ref-count">+{rest.length}</span>
          <div className="ref-popover">
            {labels.map((l) => (
              <RefPill key={l.key} path={path} label={l} color={color} prs={prs} />
            ))}
          </div>
        </div>
      )}
      <div className="ref-connector" />
    </div>
  )
}

function RefPill(props: { path: string; label: RefLabel; color: string; prs: Map<string, number[]> }) {
  const { path, label, color } = props
  const numbers = [
    ...new Set([label.local, ...label.remotes].flatMap((r) => (r ? (props.prs.get(r.fullName) ?? []) : [])))
  ]
  const primary = label.local ?? label.remotes[0] ?? label.tag!
  const title = [label.local?.name, ...label.remotes.map((r) => r.name), label.tag?.name].filter(Boolean).join('\n')
  return (
    <span
      className={cx('ref-pill', label.isHead && 'head', label.tag && 'tag')}
      style={{ '--lane': color } as CSSProperties}
      title={title}
      onDoubleClick={(e) => {
        e.stopPropagation()
        void checkoutRef(path, primary)
      }}
      {...refDragProps(primary)}
      {...refDropProps(path, primary)}
      onContextMenu={(e) => openMenu(e, refMenu(path, primary))}
    >
      {label.isHead && <Check size={12} strokeWidth={3} />}
      {label.local && <Laptop size={12} />}
      {label.remotes.length > 0 && <Cloud size={12} />}
      {label.tag && <Tag size={12} />}
      <span className="ref-name">{label.name}</span>
      {numbers.length > 0 && <span className="ref-pr">#{numbers.join(' #')}</span>}
    </span>
  )
}

function GraphSvg({
  row,
  item,
  width,
  connector
}: {
  row: GraphRow
  item: GraphItem
  width: number
  connector: boolean
}) {
  const mid = ROW_H / 2
  const cx = laneX(row.column, GEOMETRY)
  const color = laneColor(row.color)

  let node: React.ReactNode
  if (item.kind === 'wip') {
    node = <circle cx={cx} cy={mid} r={NODE_R - 1} className="node-wip" stroke={color} />
  } else if (item.kind === 'stash') {
    node = <rect x={cx - 7} y={mid - 7} width={14} height={14} rx={3} className="node-stash" stroke={color} />
  } else if (item.commit.parents.length > 1) {
    node = <circle cx={cx} cy={mid} r={6} fill={color} className="node-merge" />
  } else {
    node = (
      <g>
        <circle cx={cx} cy={mid} r={NODE_R} fill={color} />
        <text x={cx} y={mid} className="node-initials">
          {initials(item.commit.authorName)}
        </text>
      </g>
    )
  }

  return (
    <svg width={width} height={ROW_H} className="graph-svg">
      {/* Translucent band from the node to the edge of the graph, in the lane colour. */}
      <rect
        x={cx}
        y={mid - NODE_R}
        width={Math.max(0, width - cx)}
        height={NODE_R * 2}
        fill={color}
        className="row-band"
      />
      {connector && <line x1={0} y1={mid} x2={cx} y2={mid} stroke={color} strokeWidth={1.5} />}
      {row.lines.map((line, i) => (
        <path
          key={i}
          d={linePath(line, GEOMETRY)}
          stroke={laneColor(line.color)}
          strokeWidth={2}
          fill="none"
          strokeDasharray={line.dashed ? '4 3' : undefined}
        />
      ))}
      {node}
    </svg>
  )
}
