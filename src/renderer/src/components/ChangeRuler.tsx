import { useLayoutEffect, useState, type RefObject } from 'react'
import { changeMarks, type ChangeKind, type ChangeMark, type ChangedLine } from '../diffMarks'
import { useT } from '../i18n'
import { cx } from '../utils'

/** What to mark: the elements, the kind of each, the kinds in their order at one place, and the ruler's tooltip. */
export interface RulerMarks {
  selector: string
  kind: (el: HTMLElement) => ChangeKind
  kinds: ChangeKind[]
  title: string
}

/** A diff's changed lines, by the classes of their rows. */
function diffMarks(title: string): RulerMarks {
  return {
    selector: '.diff-line.add, .diff-line.del, .split-cell.add, .split-cell.del',
    kind: (el) => (el.classList.contains('add') ? 'add' : 'del'),
    kinds: ['del', 'add'],
    title
  }
}

/**
 * Marks beside a diff's scrollbar where its changes are, as VS Code shows them (red: deleted, green: added): with the
 * whole file shown, they say where to scroll. A click there goes there. `shown` changes whenever what the diff draws
 * does. `marks` marks something else (a conflict editor's blocks).
 */
export function ChangeRuler({
  body,
  shown,
  marks: what
}: {
  body: RefObject<HTMLDivElement | null>
  shown: readonly unknown[]
  marks?: RulerMarks
}) {
  const t = useT()
  const [marks, setMarks] = useState<ChangeMark[]>([])
  // The scrollbar's width: the marks go just inside it.
  const [inset, setInset] = useState(0)
  const config = what ?? diffMarks(t('diff.changeRuler'))

  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const measure = () => {
      // Everything fits: nothing to scroll to.
      if (el.scrollHeight <= el.clientHeight + 1) return setMarks([])
      const base = el.getBoundingClientRect().top - el.scrollTop
      const lines = [...el.querySelectorAll<HTMLElement>(config.selector)].map((line): ChangedLine => {
        const rect = line.getBoundingClientRect()
        return { kind: config.kind(line), top: rect.top - base, height: rect.height }
      })
      setMarks(changeMarks(lines, el.scrollHeight, config.kinds))
      setInset(el.offsetWidth - el.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [body, ...shown])

  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = body.current
    if (!el || e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    el.scrollTo({ top: ((e.clientY - rect.top) / rect.height) * el.scrollHeight - el.clientHeight / 2 })
  }

  if (!marks.length) return null
  return (
    <div className="change-ruler" style={{ right: inset }} title={config.title} onMouseDown={jump}>
      {marks.map((mark, i) => (
        <div
          key={i}
          className={cx('change-mark', mark.kind)}
          style={{ top: `${mark.top * 100}%`, height: `max(4px, ${mark.height * 100}%)` }}
        />
      ))}
    </div>
  )
}
