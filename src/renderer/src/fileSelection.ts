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
 * Shift on a checkbox gives the range the state that checkbox takes, so a range
 * can be unchecked too.
 */
export function clickSelection(
  selection: FileSelection,
  order: string[],
  clicked: string,
  mods: { shift: boolean; toggle: boolean; checkbox?: boolean }
): FileSelection {
  if (mods.shift) {
    const from = selection.anchor ? order.indexOf(selection.anchor) : -1
    const to = order.indexOf(clicked)
    // No file to start from (none clicked yet, or it left the list): just this one, never a jump to the top.
    const range = from < 0 ? [clicked] : order.slice(Math.min(from, to), Math.max(from, to) + 1)
    if (mods.checkbox) {
      const check = !selection.paths.has(clicked)
      const paths = new Set(selection.paths)
      for (const path of range) {
        if (check) paths.add(path)
        else paths.delete(path)
      }
      return { paths, anchor: clicked }
    }
    const paths = new Set(mods.toggle ? [...selection.paths, ...range] : range)
    return { paths, anchor: from < 0 ? clicked : selection.anchor }
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

/** What a discard confirmation says: the file's name when there is one, otherwise how many, and how many are new. */
export function discardSummary(files: { path: string; status: string }[]): {
  name: string | null
  count: number
  untracked: number
} {
  return {
    name: files.length === 1 ? files[0].path : null,
    count: files.length,
    untracked: files.filter((f) => f.status === '?').length
  }
}
