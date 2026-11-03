/**
 * The commits picked in the graph after a click with Ctrl (`toggle`: the clicked one in or out, the one selected
 * before kept) or Shift (`range`: every commit between the selected one and the clicked one). `order` is the
 * graph's, newest first.
 */
export function pickCommits(
  picked: string[],
  selected: string | null,
  clicked: string,
  mode: 'toggle' | 'range',
  order: string[]
): string[] {
  if (!selected || selected === clicked) return picked.length ? picked : [clicked]
  if (mode === 'range') {
    const [from, to] = [order.indexOf(selected), order.indexOf(clicked)]
    if (from < 0 || to < 0) return [clicked]
    return order.slice(Math.min(from, to), Math.max(from, to) + 1)
  }
  const start = picked.length ? picked : [selected]
  return start.includes(clicked) ? start.filter((h) => h !== clicked) : [...start, clicked]
}

/** The picked commits in the order they were made (the graph's reversed). */
export function oldestFirst(picked: string[], order: string[]): string[] {
  return [...picked].sort((a, b) => order.indexOf(b) - order.indexOf(a))
}
