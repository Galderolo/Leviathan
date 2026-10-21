import type { DiffHunk } from './types'

/**
 * Hunks that add or remove the file's final newline ("\ No newline at end of
 * file") cannot be split safely: keeping the old last line as context while
 * appending lines after it would glue them together (`b` + `c` -> `bc`).
 */
export function supportsLineSelection(hunk: DiffHunk): boolean {
  return !hunk.lines.some((l) => l.type === 'meta')
}

/**
 * Builds a patch containing only the selected lines of `hunk`.
 *
 * - Staging (`reverse = false`, applied with `git apply --cached`): unselected
 *   deletions become context (they stay) and unselected additions are dropped.
 * - Unstaging (`reverse = true`, applied with `--cached --reverse`): the patch's
 *   new side must match the index, so unselected additions become context and
 *   unselected deletions are dropped.
 *
 * `selected` holds indexes into `hunk.lines`. Returns null when no added or
 * deleted line is selected. Lines are taken from the raw patch so CRLF endings survive.
 */
export function buildPartialPatch(
  header: string,
  hunk: DiffHunk,
  selected: Set<number>,
  reverse: boolean
): string | null {
  if (!supportsLineSelection(hunk)) {
    // Only the whole change is safe here; see supportsLineSelection.
    const all = hunk.lines.every((l, i) => (l.type !== 'add' && l.type !== 'del') || selected.has(i))
    return all ? header + hunk.patch : null
  }
  const raw = hunk.patch.split('\n').slice(1, 1 + hunk.lines.length)
  const out: string[] = []
  let oldCount = 0
  let newCount = 0
  let changes = 0
  let previousKept = false

  hunk.lines.forEach((line, i) => {
    const text = raw[i].slice(1)
    let emitted: string | null = null
    if (line.type === 'ctx') emitted = ' ' + text
    else if (line.type === 'meta') emitted = previousKept ? raw[i] : null
    else if (selected.has(i)) {
      emitted = (line.type === 'add' ? '+' : '-') + text
      changes++
    } else if ((line.type === 'del') !== reverse) {
      // Staging keeps unselected deletions; unstaging keeps unselected additions.
      emitted = ' ' + text
    }

    if (line.type !== 'meta') previousKept = emitted !== null
    if (emitted === null) return
    out.push(emitted)
    if (emitted[0] === ' ' || emitted[0] === '-') oldCount++
    if (emitted[0] === ' ' || emitted[0] === '+') newCount++
  })

  if (!changes) return null
  return `${header}@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${out.join('\n')}\n`
}
