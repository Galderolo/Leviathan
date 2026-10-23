import { Fragment, useMemo } from 'react'
import { Columns2, Rows2 } from 'lucide-react'
import type { DiffHunk, DiffLine } from '../../../shared/types'
import { mergeSegments, type SyntaxToken } from '../../../shared/syntax'
import { pairChanges, splitRows, wordDiff, type Span } from '../../../shared/wordDiff'
import { useT } from '../i18n'
import { DIFF_LAYOUT_KEY, useStore, type DiffLayout } from '../store'
import { cx } from '../utils'

function setDiffLayout(layout: DiffLayout): void {
  useStore.setState({ diffLayout: layout })
  try {
    localStorage.setItem(DIFF_LAYOUT_KEY, layout)
  } catch {
    // not critical: the next start shows the unified view
  }
}

/** Unified / side-by-side switch for diff headers. */
export function DiffLayoutToggle() {
  const t = useT()
  const layout = useStore((s) => s.diffLayout)
  return (
    <span className="layout-toggle">
      <button
        className={cx('icon-btn', layout === 'unified' && 'on')}
        title={t('diff.unified')}
        onClick={() => setDiffLayout('unified')}
      >
        <Rows2 size={15} />
      </button>
      <button
        className={cx('icon-btn', layout === 'split' && 'on')}
        title={t('diff.split')}
        onClick={() => setDiffLayout('split')}
      >
        <Columns2 size={15} />
      </button>
    </span>
  )
}

/** For each changed line paired with its other version, the words that changed in it. */
export function wordSpans(hunk: DiffHunk): Map<number, Span[]> {
  const spans = new Map<number, Span[]>()
  for (const [i, j] of pairChanges(hunk.lines)) {
    if (hunk.lines[i].type !== 'del') continue
    const diff = wordDiff(hunk.lines[i].text, hunk.lines[j].text)
    if (!diff) continue
    spans.set(i, diff.old)
    spans.set(j, diff.new)
  }
  return spans
}

/** The text of a line, highlighted as code, with the words that changed marked. */
export function LineText({ line, spans, syntax }: { line: DiffLine; spans?: Span[]; syntax?: SyntaxToken[] }) {
  if (!spans && !syntax?.length) return <span className="code">{line.text || ' '}</span>
  return (
    <span className="code">
      {mergeSegments(line.text, syntax, spans).map((s, i) => {
        const text = s.cls ? <span className={s.cls}>{s.text}</span> : s.text
        return s.changed ? (
          <mark key={i} className="word-change">
            {text}
          </mark>
        ) : (
          <Fragment key={i}>{text}</Fragment>
        )
      })}
    </span>
  )
}

/** A hunk side by side: old version on the left, new on the right. Read-only. */
export function SplitHunkLines({
  hunk,
  limit,
  syntax
}: {
  hunk: DiffHunk
  limit: number
  syntax?: Map<number, SyntaxToken[]> | null
}) {
  const spans = useMemo(() => wordSpans(hunk), [hunk])
  const rows = useMemo(() => splitRows(hunk.lines), [hunk])
  const side = (index: number | null, which: 'left' | 'right') => {
    if (index === null) return <div className="split-cell empty" />
    const line = hunk.lines[index]
    const no = which === 'left' ? line.oldNo : line.newNo
    const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '
    return (
      <div className={cx('split-cell', line.type)}>
        <span className="ln">{no ?? ''}</span>
        <span className="sign">{sign}</span>
        <LineText line={line} spans={spans.get(index)} syntax={syntax?.get(index)} />
      </div>
    )
  }
  return (
    <div className="hunk-lines split">
      {rows.slice(0, limit).map((row, i) => (
        <div key={i} className="split-row">
          {side(row.left, 'left')}
          {side(row.right, 'right')}
        </div>
      ))}
    </div>
  )
}
