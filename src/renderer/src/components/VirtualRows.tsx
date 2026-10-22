import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { visibleRange } from '../virtualRows'

/** Height of a `.file-row` in px; the CSS and the virtual lists must agree. */
export const FILE_ROW_HEIGHT = 25

const OVERSCAN = 10

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return p
  }
  return null
}

/**
 * Fixed-height rows that only renders those near the visible part of its scrolling container (the closest
 * scrolling ancestor), so lists of tens of thousands of files stay responsive. `render` must set each row's key.
 */
export function VirtualRows<T>(props: {
  items: T[]
  rowHeight: number
  render: (item: T, index: number) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const count = props.items.length
  const { rowHeight } = props
  const [range, setRange] = useState({ start: 0, end: 60 })

  useLayoutEffect(() => {
    const list = ref.current
    const scroller = list && scrollParent(list)
    if (!list || !scroller) {
      setRange({ start: 0, end: count })
      return
    }
    const update = () => {
      const offset = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      const next = visibleRange({
        scrollTop: scroller.scrollTop,
        viewport: scroller.clientHeight,
        offset,
        rowHeight,
        count,
        overscan: OVERSCAN
      })
      setRange((r) => (r.start === next.start && r.end === next.end ? r : next))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [count, rowHeight])

  const start = Math.min(range.start, count)
  const end = Math.min(range.end, count)
  return (
    <div ref={ref} style={{ height: count * rowHeight, position: 'relative' }}>
      <div style={{ transform: `translateY(${start * rowHeight}px)` }}>
        {props.items.slice(start, end).map((item, i) => props.render(item, start + i))}
      </div>
    </div>
  )
}
