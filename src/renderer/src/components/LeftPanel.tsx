import { useState, type ReactNode } from 'react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  GitBranch,
  Laptop,
  Plus,
  Search,
  Tag,
  X
} from 'lucide-react'
import type { GitRef, Stash } from '../../../shared/types'
import { addRemote, checkoutRef, selectRef, selectStash } from '../actions'
import { useT } from '../i18n'
import { branchMenu, remoteMenu, stashMenu, tagMenu } from '../menus'
import { useRepo, useStore } from '../store'
import { openMenu } from '../ui'
import { buildTree, cx, formatDate, relativeDate, type TreeNode } from '../utils'
import { refDragProps, refDropProps } from './refDnd'

type Collapsed = Record<string, boolean>

export function LeftPanel({ path }: { path: string }) {
  const view = useRepo(path)
  const t = useT()
  const lang = useStore((s) => s.lang)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Collapsed>({})
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  const state = view?.state
  const f = filter.trim().toLowerCase()
  const match = (name: string) => !f || name.toLowerCase().includes(f)
  const refs = state?.refs ?? []
  const locals = refs.filter((r) => r.type === 'head' && match(r.name))
  const remoteRefs = refs.filter((r) => r.type === 'remote' && match(r.name))
  const tags = refs.filter((r) => r.type === 'tag' && match(r.name))
  const stashes = (state?.stashes ?? []).filter((s) => match(s.message))
  const remotes = state?.remotes ?? []
  const selectedHash = view?.selection && view.selection.kind !== 'wip' ? view.selection.hash : null

  const branchRow = (ref: GitRef, name: string) => (
    <div
      className={cx('side-row', ref.isHead && 'head', selectedHash === ref.hash && 'selected')}
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
        <span className="ab-badge gone">
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
        />
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

function TreeView(props: {
  nodes: TreeNode<GitRef>[]
  prefix: string
  depth?: number
  collapsed: Collapsed
  toggle: (key: string) => void
  leaf: (ref: GitRef, name: string) => ReactNode
}) {
  const depth = props.depth ?? 0
  return (
    <>
      {props.nodes.map((node) => {
        const key = props.prefix + node.path
        if (node.item) {
          return (
            <div key={key} style={{ paddingLeft: depth * 14 }}>
              {props.leaf(node.item, node.name)}
            </div>
          )
        }
        const closed = props.collapsed[key]
        return (
          <div key={key}>
            <div className="side-row folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => props.toggle(key)}>
              {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <Folder size={13} className="dim" />
              <span className="side-name">{node.name}</span>
            </div>
            {!closed && (
              <TreeView
                nodes={node.children}
                prefix={props.prefix}
                depth={depth + 1}
                collapsed={props.collapsed}
                toggle={props.toggle}
                leaf={props.leaf}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
