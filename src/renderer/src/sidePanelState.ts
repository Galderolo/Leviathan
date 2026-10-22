/** Collapsed sections and folders of the side panel: key → true. */
export type Collapsed = Record<string, boolean>

interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const KEY = 'leviathan.collapsed:'

function browserStore(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** What the user collapsed in a repository's side panel, kept across tab switches and restarts. */
export function readCollapsed(path: string, store = browserStore()): Collapsed {
  try {
    const saved: unknown = JSON.parse(store?.getItem(KEY + path) ?? 'null')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => v === true))
  } catch {
    return {}
  }
}

export function writeCollapsed(path: string, collapsed: Collapsed, store = browserStore()): void {
  const kept = Object.fromEntries(Object.entries(collapsed).filter(([, v]) => v))
  try {
    if (Object.keys(kept).length) store?.setItem(KEY + path, JSON.stringify(kept))
    else store?.removeItem(KEY + path)
  } catch {
    // not critical: the panel opens fully expanded next time
  }
}
