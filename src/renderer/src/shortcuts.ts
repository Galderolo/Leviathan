import type { TKey } from './i18n'

/** What a shortcut needs from a key press (a KeyboardEvent has it all). */
export interface KeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export type GlobalShortcut =
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'previousTab'
  | 'goToTab'
  | 'openRepo'
  | 'undo'
  | 'redo'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'newBranch'
  | 'stash'
  | 'search'
  | 'refresh'
  | 'settings'
  | 'shortcuts'

const WITH_MOD: Record<string, GlobalShortcut> = {
  t: 'newTab',
  w: 'closeTab',
  o: 'openRepo',
  z: 'undo',
  y: 'redo',
  p: 'push',
  l: 'pull',
  b: 'newBranch',
  f: 'search',
  ',': 'settings'
}

const WITH_MOD_SHIFT: Record<string, GlobalShortcut> = { f: 'fetch', s: 'stash', z: 'redo' }

/**
 * The app-wide shortcut a key press means (Ctrl, or ⌘ on macOS), with the tab's number for `goToTab` (9 = the
 * last one, as in browsers); null for any other key.
 */
export function globalShortcut(e: KeyInput): { id: GlobalShortcut; tab?: number } | null {
  const mod = e.ctrlKey || e.metaKey
  if (!mod && !e.shiftKey && !e.altKey) {
    if (e.key === 'F5') return { id: 'refresh' }
    if (e.key === 'F1') return { id: 'shortcuts' }
  }
  if (!mod || e.altKey) return null
  if (e.key === 'Tab') return { id: e.shiftKey ? 'previousTab' : 'nextTab' }
  // Some keyboards (Spanish) type / with Shift.
  if (e.key === '/') return { id: 'shortcuts' }
  const key = e.key.toLowerCase()
  if (e.shiftKey) return WITH_MOD_SHIFT[key] ? { id: WITH_MOD_SHIFT[key] } : null
  if (/^[1-9]$/.test(key)) return { id: 'goToTab', tab: Number(key) }
  return WITH_MOD[key] ? { id: WITH_MOD[key] } : null
}

export type FileKey = 'previous' | 'next' | 'stageToggle' | 'discard'

/** What a key press means in a list of changed files. */
export function fileKey(e: KeyInput, mac: boolean): FileKey | null {
  // The Mac's delete key types Backspace: discarding takes ⌘ with it, as deleting a file in the Finder does.
  if (mac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'Backspace') return 'discard'
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null
  if (e.key === 'ArrowUp') return 'previous'
  if (e.key === 'ArrowDown') return 'next'
  if (e.key === ' ') return 'stageToggle'
  if (e.key === 'Delete') return 'discard'
  return null
}

/** The file before or after `current` in the list (staying at its ends); from the first or last when none is open. */
export function neighbour(order: string[], current: string | null, delta: 1 | -1): string | null {
  if (!order.length) return null
  const at = current === null ? -1 : order.indexOf(current)
  if (at === -1) return delta > 0 ? order[0] : order[order.length - 1]
  return order[Math.min(order.length - 1, Math.max(0, at + delta))]
}

/** The file to show once `leaving` left the list: the first one after `current` that stays, else the last before. */
export function nextAfter(order: string[], leaving: string[], current: string | null): string | null {
  const gone = new Set(leaving)
  const at = current === null ? -1 : order.indexOf(current)
  const after = order.slice(at + 1).find((p) => !gone.has(p))
  if (after) return after
  return (
    order
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((p) => !gone.has(p)) ?? null
  )
}

export interface ShortcutHelp {
  /** As pressed on Windows and Linux; `Mod` is Ctrl there and ⌘ on macOS. */
  keys: string[]
  /** When macOS uses other keys. */
  macKeys?: string[]
  label: TKey
}

/** Every shortcut, for the list in Settings. */
export const SHORTCUT_GROUPS: { title: TKey; items: ShortcutHelp[] }[] = [
  {
    title: 'keys.groupFiles',
    items: [
      { keys: ['Up'], label: 'keys.previousFile' },
      { keys: ['Down'], label: 'keys.nextFile' },
      { keys: ['Space'], label: 'keys.stageToggle' },
      { keys: ['Delete'], macKeys: ['Mod', 'Backspace'], label: 'keys.discard' },
      { keys: ['Mod', 'Enter'], label: 'keys.commit' }
    ]
  },
  {
    title: 'keys.groupRepository',
    items: [
      { keys: ['Mod', 'Z'], label: 'keys.undo' },
      { keys: ['Mod', 'Y'], label: 'keys.redo' },
      { keys: ['Mod', 'Shift', 'F'], label: 'keys.fetch' },
      { keys: ['Mod', 'L'], label: 'keys.pull' },
      { keys: ['Mod', 'P'], label: 'keys.push' },
      { keys: ['Mod', 'B'], label: 'keys.newBranch' },
      { keys: ['Mod', 'Shift', 'S'], label: 'keys.stash' },
      { keys: ['Mod', 'F'], label: 'keys.search' },
      { keys: ['F5'], label: 'keys.refresh' },
      { keys: ['Esc'], label: 'keys.close' }
    ]
  },
  {
    title: 'keys.groupApp',
    items: [
      { keys: ['Mod', 'T'], label: 'keys.newTab' },
      { keys: ['Mod', 'W'], label: 'keys.closeTab' },
      { keys: ['Mod', 'Tab'], label: 'keys.nextTab' },
      { keys: ['Mod', 'Shift', 'Tab'], label: 'keys.previousTab' },
      { keys: ['Mod', '1…9'], label: 'keys.goToTab' },
      { keys: ['Mod', 'O'], label: 'keys.openRepo' },
      { keys: ['Mod', ','], label: 'keys.settings' },
      { keys: ['F1'], label: 'keys.shortcuts' }
    ]
  }
]

const SYMBOLS: Record<string, [mac: string, other: string]> = {
  Mod: ['⌘', 'Ctrl'],
  Shift: ['⇧', 'Shift'],
  Alt: ['⌥', 'Alt'],
  Enter: ['↩', 'Enter'],
  Backspace: ['⌫', 'Backspace'],
  Tab: ['⇥', 'Tab'],
  Up: ['↑', '↑'],
  Down: ['↓', '↓']
}

/** Keys as each system writes them: `Ctrl+Shift+F`, or `⌘⇧F` on macOS. `names`: keys spelt in the user's language. */
export function keysLabel(keys: string[], mac: boolean, names: Record<string, string> = {}): string {
  const shown = keys.map((k) => names[k] ?? SYMBOLS[k]?.[mac ? 0 : 1] ?? k)
  return shown.join(mac ? '' : '+')
}
