/** Rows of a fixed-height list worth rendering: those on screen and `overscan` more on each side. */
export function visibleRange(opts: {
  /** Scroll position of the scrolling container. */
  scrollTop: number
  /** Visible height of the scrolling container. */
  viewport: number
  /** Distance from the top of the container's content to the first row. */
  offset: number
  rowHeight: number
  count: number
  overscan: number
}): { start: number; end: number } {
  const { scrollTop, viewport, offset, rowHeight, count, overscan } = opts
  const clamp = (n: number) => Math.min(count, Math.max(0, n))
  const top = scrollTop - offset
  return {
    start: clamp(Math.floor(top / rowHeight) - overscan),
    end: clamp(Math.ceil((top + viewport) / rowHeight) + overscan)
  }
}
