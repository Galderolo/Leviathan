import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react'
import {
  conflictCount,
  draftConflicts,
  lineEnding,
  parseConflicts,
  resolveConflicts,
  withLineEnding,
  type Choice,
  type Segment
} from '../../../shared/conflicts'
import { imageType } from '../../../shared/images'
import type { SyntaxToken } from '../../../shared/syntax'
import type { DiffHunk, WorkingFile } from '../../../shared/types'
import type { Span } from '../../../shared/wordDiff'
import { closeDiff, openFile, resolveWithContent, resolveWithSide } from '../actions'
import { conflictLayout } from '../conflictLayout'
import { useT } from '../i18n'
import { useStore } from '../store'
import { highlightHunks } from '../syntax'
import { confirmDialog, errorMessage } from '../ui'
import { ChangeRuler } from './ChangeRuler'
import { DiffLayoutToggle, LineText, wordSpans } from './DiffLines'
import { ImageDiff } from './ImageDiff'
import { cx, splitPath } from '../utils'

const api = window.leviathan

const CHOICES: { value: Exclude<Choice, null>; key: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { value: 'ours', key: 'conflict.useCurrent' },
  { value: 'theirs', key: 'conflict.useIncoming' },
  { value: 'ours-theirs', key: 'conflict.useBoth' },
  { value: 'theirs-ours', key: 'conflict.useBothReversed' }
]

/**
 * Lines `from`–`to` of the file's diff of its two sides: each numbered in its version, its code coloured, the words
 * that differ from the other side marked.
 */
function CodeLines({
  hunk,
  spans,
  syntax,
  from,
  to
}: {
  hunk: DiffHunk | null
  spans: Map<number, Span[]>
  syntax: Map<number, SyntaxToken[]> | null
  from: number
  to: number
}) {
  if (!hunk) return null
  const rows = []
  for (let i = from; i < to; i++) {
    const line = hunk.lines[i]
    rows.push(
      <div key={i} className="conflict-line">
        <span className="ln">{line.type === 'add' ? line.newNo : line.oldNo}</span>
        <LineText line={line} spans={spans.get(i)} syntax={syntax?.get(i)} />
      </div>
    )
  }
  return <div className="conflict-lines">{rows}</div>
}

/** A plain text editor with line numbers for a whole file; Tab types a tab. */
function HandEditor({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const gutter = useRef<HTMLPreElement>(null)
  const count = value.split('\n').length
  const numbers = useMemo(() => Array.from({ length: count }, (_, i) => i + 1).join('\n'), [count])
  return (
    <div className="conflict-editor">
      <pre className="conflict-editor-gutter" ref={gutter} aria-hidden>
        {numbers}
      </pre>
      <textarea
        value={value}
        spellCheck={false}
        wrap="off"
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
          e.preventDefault()
          // Through the editing commands, so Ctrl+Z still undoes it.
          document.execCommand('insertText', false, '\t')
        }}
      />
    </div>
  )
}

/** Resolves a conflicted file block by block, or by taking one side of the whole file. */
export function ConflictView({ path, file }: { path: string; file: string }) {
  const t = useT()
  const [read, setRead] = useState<WorkingFile | null>(null)
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [choices, setChoices] = useState<Choice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped to read the file again, e.g. after a save refused because it changed.
  const [version, setVersion] = useState(0)
  // The whole file being edited by hand (LF line ends, as a text box keeps them), and what it started as.
  const [draft, setDraft] = useState<{ text: string; start: string } | null>(null)
  // Folds of unconflicted lines opened, and the conflict last gone to or worked on.
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set())
  const [current, setCurrent] = useState(0)
  const diffLayout = useStore((s) => s.diffLayout)
  const body = useRef<HTMLDivElement>(null)
  const { dir, name } = splitPath(file)

  // The file as a diff of its two sides: colours, words that differ and line numbers as in a diff.
  const layout = useMemo(() => (segments ? conflictLayout(segments) : null), [segments])
  const code = useMemo(
    () => ({
      hunk: layout?.hunk ?? null,
      spans: layout ? wordSpans(layout.hunk) : new Map<number, Span[]>(),
      syntax: layout ? highlightHunks([layout.hunk], file)[0] : null
    }),
    [layout, file]
  )
  const conflicts = useMemo(
    () => (segments ?? []).filter((s): s is Extract<Segment, { kind: 'conflict' }> => s.kind === 'conflict'),
    [segments]
  )

  const goTo = (index: number) => {
    if (index < 0 || index >= conflicts.length) return
    setCurrent(index)
    body.current?.querySelector(`[data-conflict="${index}"]`)?.scrollIntoView({ block: 'center' })
  }
  const goToRef = useRef(goTo)
  goToRef.current = goTo
  const currentRef = useRef(current)
  currentRef.current = current

  // A file just read opens at its first conflict.
  useLayoutEffect(() => {
    if (layout?.parts.some((p) => p.kind === 'conflict')) goToRef.current(0)
  }, [layout])

  // Alt+↑ / Alt+↓ go to the previous / next conflict.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || useStore.getState().dialog) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      goToRef.current(currentRef.current + (e.key === 'ArrowDown' ? 1 : -1))
    }
    if (draft) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft])

  useEffect(() => {
    let live = true
    setSegments(null)
    setError(null)
    setDraft(null)
    setUnfolded(new Set())
    setCurrent(0)
    api
      .readWorkingFile(path, file)
      .then((result) => {
        if (!live) return
        const parsed = result.text === null ? [] : parseConflicts(result.text)
        setRead(result)
        setSegments(parsed)
        setChoices(new Array(conflictCount(parsed)).fill(null))
      })
      .catch((err) => live && setError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, file, version])

  const takeSide = async (side: 'ours' | 'theirs') => {
    setBusy(true)
    await resolveWithSide(path, file, side)
    setBusy(false)
  }

  const save = async (content: string, original: string) => {
    setBusy(true)
    // Text typed by hand stays on screen when the save is refused; the blocks are read again.
    if (!(await resolveWithContent(path, file, content, original)) && !draft) setVersion((v) => v + 1)
    setBusy(false)
  }

  const editByHand = () => {
    if (!segments) return
    const text = draftConflicts(segments, choices).replace(/\r\n/g, '\n')
    setDraft({ text, start: text })
  }

  const saveDraft = async () => {
    if (!draft || read?.text == null) return
    const left = conflictCount(parseConflicts(draft.text))
    if (
      left &&
      !(await confirmDialog({
        title: t('conflict.save'),
        message: t('dlg.saveWithMarkers', { count: left }),
        confirmText: t('dlg.saveAnyway'),
        danger: true
      }))
    ) {
      return
    }
    await save(withLineEnding(draft.text, lineEnding(read.text)), read.text)
  }

  const backToBlocks = async () => {
    if (
      draft &&
      draft.text !== draft.start &&
      !(await confirmDialog({
        title: t('conflict.backToBlocks'),
        message: t('dlg.dropHandEdits'),
        confirmText: t('dlg.dropChanges'),
        danger: true
      }))
    ) {
      return
    }
    // The file again, as it is now.
    setVersion((v) => v + 1)
  }

  // An image shows as its two sides (a Git LFS one has a conflicted pointer, not the picture).
  const image = !!imageType(file)
  const total = segments ? conflictCount(segments) : 0
  const done = choices.filter(Boolean).length
  const result = segments ? resolveConflicts(segments, choices) : null
  const markersLeft = draft ? conflictCount(parseConflicts(draft.text)) : 0
  const firstConflict = conflicts[0]
  const oursLabel = firstConflict?.oursLabel ?? ''
  const theirsLabel = firstConflict?.theirsLabel ?? ''

  return (
    <div className="diff-view">
      <div className="diff-header">
        <div className="diff-title">
          <span className="diff-context">{t('diff.conflicted')}</span>
          <span className="file-dir">{dir}</span>
          <span className="file-name">{name}</span>
        </div>
        <div className="diff-actions">
          <button className="btn small" disabled={busy || !!draft} onClick={() => void takeSide('ours')}>
            {t('conflict.takeCurrent')}
            {oursLabel && <span className="dim"> ({oursLabel})</span>}
          </button>
          <button className="btn small" disabled={busy || !!draft} onClick={() => void takeSide('theirs')}>
            {t('conflict.takeIncoming')}
            {theirsLabel && <span className="dim"> ({theirsLabel})</span>}
          </button>
          <button className="icon-btn" title={t('menu.openFile')} onClick={() => openFile(path, file)}>
            <ExternalLink size={15} />
          </button>
          <button className="icon-btn" title={`${t('diff.close')} (Esc)`} onClick={() => closeDiff(path)}>
            <X size={16} />
          </button>
        </div>
      </div>

      {draft && <HandEditor value={draft.text} onChange={(text) => setDraft((d) => d && { ...d, text })} />}
      <div className="diff-scroll" hidden={!!draft}>
        <div className="diff-body conflict-body" ref={body}>
          {error && <div className="empty-state error">{error}</div>}
          {!error && !segments && <div className="empty-state">{t('graph.loading')}</div>}
          {image && segments && (
            <ImageDiff
              repo={path}
              source={{ kind: 'unstaged', path: file, conflicted: true }}
              version={version}
              labels={{ before: t('conflict.current'), after: t('conflict.incoming') }}
            />
          )}
          {!image && segments && total === 0 && (
            <div className="empty-state">
              {t(
                read?.reason === 'large'
                  ? 'conflict.tooLarge'
                  : read?.reason === 'encoding'
                    ? 'conflict.encoding'
                    : read?.reason === 'missing'
                      ? 'conflict.missing'
                      : 'conflict.noMarkers'
              )}
            </div>
          )}
          {!image &&
            layout &&
            total > 0 &&
            layout.parts.map((part) => {
              if (part.kind === 'lines') {
                return (
                  <div key={`l${part.from}`} className="conflict-common">
                    <CodeLines {...code} from={part.from} to={part.to} />
                  </div>
                )
              }
              if (part.kind === 'fold') {
                if (unfolded.has(part.id)) {
                  return (
                    <div key={`l${part.from}`} className="conflict-common">
                      <CodeLines {...code} from={part.from} to={part.to} />
                    </div>
                  )
                }
                return (
                  <button
                    key={`f${part.id}`}
                    className="conflict-fold"
                    onClick={() => setUnfolded((prev) => new Set(prev).add(part.id))}
                  >
                    {t('conflict.folded', { count: part.to - part.from })}
                  </button>
                )
              }
              const { index } = part
              const segment = conflicts[index]
              const choice = choices[index]
              const pick = (value: Exclude<Choice, null>) => {
                setChoices((prev) => prev.map((c, i) => (i === index ? value : c)))
                setCurrent(index)
              }
              return (
                <div
                  key={`c${index}`}
                  data-conflict={index}
                  className={cx('conflict-block', choice && 'resolved', index === current && 'current')}
                >
                  <div className="conflict-block-title">
                    <span>{t('conflict.position', { index: index + 1, count: total })}</span>
                    <span>{t(choice ? 'conflict.resolved' : 'conflict.unresolved')}</span>
                  </div>
                  <div className={cx('conflict-sides', diffLayout === 'unified' && 'stacked')}>
                    <div className={cx('conflict-side ours', choice?.includes('ours') && 'chosen')}>
                      <div className="conflict-side-title">
                        {t('conflict.current')} <span className="dim">{segment.oursLabel}</span>
                      </div>
                      <CodeLines {...code} from={part.ours[0]} to={part.ours[1]} />
                    </div>
                    <div className={cx('conflict-side theirs', choice?.includes('theirs') && 'chosen')}>
                      <div className="conflict-side-title">
                        {t('conflict.incoming')} <span className="dim">{segment.theirsLabel}</span>
                      </div>
                      <CodeLines {...code} from={part.theirs[0]} to={part.theirs[1]} />
                    </div>
                  </div>
                  <div className="conflict-choices">
                    {CHOICES.map((c) => (
                      <button
                        key={c.value}
                        className={cx('btn tiny', choice === c.value && 'btn-primary')}
                        onClick={() => pick(c.value)}
                      >
                        {t(c.key)}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
        {!image && layout && total > 0 && (
          <ChangeRuler
            body={body}
            shown={[layout, unfolded, choices, diffLayout]}
            marks={{
              selector: '.conflict-block',
              kind: (el) => (el.classList.contains('resolved') ? 'resolved' : 'open'),
              kinds: ['open', 'resolved'],
              title: t('conflict.ruler')
            }}
          />
        )}
      </div>

      {draft && (
        <div className="conflict-footer">
          <span className="dim">
            {markersLeft ? t('conflict.markersLeft', { count: markersLeft }) : t('conflict.noMarkersLeft')}
          </span>
          <span className="conflict-footer-actions">
            <button className="btn" disabled={busy} onClick={() => void backToBlocks()}>
              {t('conflict.backToBlocks')}
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void saveDraft()}>
              {t('conflict.save')}
            </button>
          </span>
        </div>
      )}
      {!draft && !image && segments && total > 0 && (
        <div className="conflict-footer">
          <span className="conflict-footer-info">
            <DiffLayoutToggle />
            <span className="conflict-nav">
              <span>{t('conflict.position', { index: current + 1, count: total })}</span>
              <button
                className="icon-btn"
                title={t('conflict.previous')}
                disabled={current <= 0}
                onClick={() => goTo(current - 1)}
              >
                <ChevronUp size={15} />
              </button>
              <button
                className="icon-btn"
                title={t('conflict.next')}
                disabled={current >= total - 1}
                onClick={() => goTo(current + 1)}
              >
                <ChevronDown size={15} />
              </button>
            </span>
            <span className="dim">{t('conflict.progress', { done, count: total })}</span>
          </span>
          <span className="conflict-footer-actions">
            <button className="btn" disabled={busy || read?.text == null} onClick={editByHand}>
              {t('conflict.editByHand')}
            </button>
            <button
              className="btn btn-primary"
              disabled={result === null || busy}
              onClick={() => {
                if (result !== null && read?.text != null) void save(result, read.text)
              }}
            >
              {t('conflict.save')}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
