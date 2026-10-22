/** Files selected in a list, and the last one clicked (where a Shift range starts). */
export interface FileSelection {
  paths: Set<string>
  anchor: string | null
}

export const emptySelection = (): FileSelection => ({ paths: new Set(), anchor: null })

/**
 * Selection after clicking `clicked` in a list shown in `order`, as in a file
 * manager: a plain click selects only that file, `toggle` (Ctrl/Cmd, or its
 * checkbox) adds or removes it, `shift` selects the range from the last click.
 */
export function clickSelection(
  selection: FileSelection,
  order: string[],
  clicked: string,
  mods: { shift: boolean; toggle: boolean }
): FileSelection {
  if (mods.shift) {
    const from = selection.anchor ? order.indexOf(selection.anchor) : -1
    const to = order.indexOf(clicked)
    const start = Math.min(from < 0 ? 0 : from, to)
    const end = Math.max(from < 0 ? 0 : from, to)
    const range = order.slice(start, end + 1)
    const paths = new Set(mods.toggle ? [...selection.paths, ...range] : range)
    return { paths, anchor: selection.anchor && from >= 0 ? selection.anchor : order[0] }
  }
  if (mods.toggle) {
    const paths = new Set(selection.paths)
    if (paths.has(clicked)) paths.delete(clicked)
    else paths.add(clicked)
    return { paths, anchor: clicked }
  }
  return { paths: new Set([clicked]), anchor: clicked }
}

/** A click that only opens a file: the checked files stay, and a Shift range will start there. */
export function focusSelection(selection: FileSelection, clicked: string): FileSelection {
  return { paths: selection.paths, anchor: clicked }
}

/** Selects every file, or none when all of them already are. */
export function toggleAll(selection: FileSelection, order: string[]): FileSelection {
  const all = order.length > 0 && order.every((p) => selection.paths.has(p))
  return all ? emptySelection() : { paths: new Set(order), anchor: selection.anchor }
}

/** Drops files no longer in the list (staged, discarded...); unchanged selections are returned as is. */
export function pruneSelection(selection: FileSelection, order: string[]): FileSelection {
  const present = new Set(order)
  const paths = [...selection.paths].filter((p) => present.has(p))
  const anchor = selection.anchor && present.has(selection.anchor) ? selection.anchor : null
  if (paths.length === selection.paths.size && anchor === selection.anchor) return selection
  return { paths: new Set(paths), anchor }
}

/** Share of the height given to the unstaged list, kept so both lists stay usable. */
export function splitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(0.85, Math.max(0.15, ratio))
}
