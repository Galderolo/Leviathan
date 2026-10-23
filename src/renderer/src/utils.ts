import { LANE_COLOR_COUNT } from '../../shared/graph'
import type { Commit, GitRef } from '../../shared/types'

export const LANE_PALETTE = [
  '#15a0bf',
  '#0669f7',
  '#8e00c2',
  '#c517b6',
  '#d90171',
  '#cd0101',
  '#f25d2e',
  '#f2ca33',
  '#7bd938',
  '#2ece9d'
]

if (LANE_PALETTE.length !== LANE_COLOR_COUNT) throw new Error('Lane palette size mismatch')

export function laneColor(index: number): string {
  return LANE_PALETTE[((index % LANE_PALETTE.length) + LANE_PALETTE.length) % LANE_PALETTE.length]
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? { dir: '', name: path } : { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) }
}

export function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export function hashColor(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return `hsl(${Math.abs(h) % 360} 45% 42%)`
}

export function formatDate(ts: number, lang: string): string {
  return new Date(ts * 1000).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
}

export function relativeDate(ts: number, lang: string): string {
  const diff = ts - Date.now() / 1000
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month')
  return rtf.format(Math.round(diff / (86400 * 365)), 'year')
}

/** One pill in the BRANCH / TAG column: a local branch with its remote twins, a lone remote branch, or a tag. */
export interface RefLabel {
  key: string
  name: string
  local?: GitRef
  remotes: GitRef[]
  tag?: GitRef
  isHead: boolean
}

export function groupRefs(refs: GitRef[]): Map<string, RefLabel[]> {
  const byHash = new Map<string, RefLabel[]>()
  const push = (hash: string, label: RefLabel) => {
    const list = byHash.get(hash) ?? []
    list.push(label)
    byHash.set(hash, list)
  }
  const locals = refs.filter((r) => r.type === 'head')
  const localLabels = new Map<string, RefLabel>()
  for (const ref of locals) {
    const label: RefLabel = { key: ref.fullName, name: ref.name, local: ref, remotes: [], isHead: !!ref.isHead }
    localLabels.set(ref.name, label)
    push(ref.hash, label)
  }
  for (const ref of refs.filter((r) => r.type === 'remote')) {
    const short = ref.remote ? ref.name.slice(ref.remote.length + 1) : ref.name
    const twin = locals.find(
      (l) => l.hash === ref.hash && (l.upstream === ref.name || (!l.upstream && l.name === short))
    )
    if (twin) localLabels.get(twin.name)!.remotes.push(ref)
    else push(ref.hash, { key: ref.fullName, name: ref.name, remotes: [ref], isHead: false })
  }
  for (const ref of refs.filter((r) => r.type === 'tag')) {
    push(ref.hash, { key: ref.fullName, name: ref.name, tag: ref, remotes: [], isHead: false })
  }
  for (const list of byHash.values()) {
    list.sort((a, b) => rank(a) - rank(b))
  }
  return byHash
}

function rank(label: RefLabel): number {
  if (label.isHead) return 0
  if (label.local) return 1
  if (label.remotes.length) return 2
  return 3
}

export interface TreeNode<T> {
  /** Last path segment. */
  name: string
  /** Full path of this node. */
  path: string
  item?: T
  children: TreeNode<T>[]
}

/** Builds a folder tree from slash-separated names (`feature/login` -> feature > login). */
export function buildTree<T>(items: T[], nameOf: (item: T) => string): TreeNode<T>[] {
  const root: TreeNode<T> = { name: '', path: '', children: [] }
  for (const item of items) {
    const parts = nameOf(item).split('/')
    let node = root
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const isLeaf = i === parts.length - 1
      let child = isLeaf ? undefined : node.children.find((c) => c.name === part && !c.item)
      if (!child) {
        child = { name: part, path, children: [] }
        node.children.push(child)
      }
      if (isLeaf) child.item = item
      node = child
    })
  }
  const sort = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => {
      const aFolder = a.children.length > 0 && !a.item
      const bFolder = b.children.length > 0 && !b.item
      if (aFolder !== bFolder) return aFolder ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

/** A row of a tree as drawn: a folder or an item, at its depth; `key` is unique within the side panel. */
export interface TreeRow<T> {
  key: string
  depth: number
  node: TreeNode<T>
}

/** The rows of a tree that show, in order: a folded folder (`collapsed[prefix + path]`) hides what it holds. */
export function visibleTreeRows<T>(
  nodes: TreeNode<T>[],
  prefix: string,
  collapsed: Record<string, boolean | undefined>,
  depth = 0,
  rows: TreeRow<T>[] = []
): TreeRow<T>[] {
  for (const node of nodes) {
    const key = prefix + node.path
    rows.push({ key, depth, node })
    if (!node.item && !collapsed[key]) visibleTreeRows(node.children, prefix, collapsed, depth + 1, rows)
  }
  return rows
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function matchesFilter(commit: Commit, filter: string): boolean {
  const f = filter.trim().toLowerCase()
  if (!f) return true
  return (
    commit.subject.toLowerCase().includes(f) ||
    commit.authorName.toLowerCase().includes(f) ||
    commit.authorEmail.toLowerCase().includes(f) ||
    commit.hash.startsWith(f)
  )
}
