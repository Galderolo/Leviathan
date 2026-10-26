/** `tabs` with tab `id` moved into gap `gap` (0 = before the first tab, `tabs.length` = after the last). */
export function moveTab<T extends { id: string }>(tabs: T[], id: string, gap: number): T[] {
  const from = tabs.findIndex((tab) => tab.id === id)
  // Dropped where it already is: either side of itself.
  if (from === -1 || gap === from || gap === from + 1) return tabs
  const rest = tabs.filter((tab) => tab.id !== id)
  const to = gap > from ? gap - 1 : gap
  return [...rest.slice(0, to), tabs[from], ...rest.slice(to)]
}
