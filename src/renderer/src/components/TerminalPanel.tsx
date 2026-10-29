import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Plus, RotateCcw, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { openTerminal, toggleTerminal } from '../actions'
import { useT } from '../i18n'
import { patchRepo, useRepo, useStore } from '../store'
import { shellLabel } from '../terminalTabs'
import { addConsole, closeConsole, restartConsole, retheme, setTerminalFontSize, showConsole } from '../terminals'
import { cx } from '../utils'

const HEIGHT_KEY = 'leviathan.terminalHeight'
const MIN_HEIGHT = 80

function savedHeight(): number {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY))
    return value >= MIN_HEIGHT ? value : 240
  } catch {
    return 240
  }
}

/**
 * The repository's terminal, at the bottom of the graph or diff: its consoles, in tabs, each a shell of its own in the
 * repository's folder.
 */
export function TerminalPanel({ path }: { path: string }) {
  const t = useT()
  const body = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(savedHeight)
  const themeSetting = useStore((s) => s.settings.theme)
  const fontSize = useStore((s) => s.settings.terminalFontSize)
  const view = useRepo(path)
  const consoles = view?.consoles ?? []
  const active = view?.activeConsole ?? null

  useEffect(() => (active === null ? undefined : showConsole(path, active, body.current!)), [path, active])
  // After App has applied the theme to the document.
  useEffect(() => {
    const frame = requestAnimationFrame(retheme)
    return () => cancelAnimationFrame(frame)
  }, [themeSetting])
  useEffect(() => setTerminalFontSize(fontSize), [fontSize])

  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const start = handle.parentElement?.getBoundingClientRect().height ?? height
    // The graph or diff above keeps some room.
    const max = Math.max(MIN_HEIGHT, (handle.parentElement?.parentElement?.clientHeight ?? 600) - 120)
    let latest = start
    const move = (ev: PointerEvent) => {
      latest = Math.round(Math.max(MIN_HEIGHT, Math.min(max, start + startY - ev.clientY)))
      setHeight(latest)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(HEIGHT_KEY, String(latest))
      } catch {
        // not critical: the next one opens at the usual height
      }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <div className="terminal-panel" style={{ height }}>
      <div className="terminal-resize" onPointerDown={resize} title={t('terminal.resize')} />
      <div className="terminal-header">
        <span className="terminal-title">{t('toolbar.terminal')}</span>
        <div className="terminal-tabs" role="tablist">
          {consoles.map((c, i) => (
            <div
              key={c.key}
              role="tab"
              aria-selected={c.key === active}
              className={cx('terminal-tab', c.key === active && 'active')}
              onMouseDown={(e) => e.button === 0 && patchRepo(path, { activeConsole: c.key })}
            >
              <span>
                {i + 1}: {c.shell ? shellLabel(c.shell) : '…'}
              </span>
              <button
                type="button"
                className="terminal-tab-close"
                title={t('terminal.closeConsole')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => closeConsole(path, c.key)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="icon-btn" title={t('terminal.new')} onClick={() => addConsole(path)}>
            <Plus size={14} />
          </button>
        </div>
        <div className="terminal-actions">
          <button
            type="button"
            className="icon-btn"
            title={t('terminal.restart')}
            disabled={active === null}
            onClick={() => active !== null && restartConsole(active)}
          >
            <RotateCcw size={14} />
          </button>
          <button type="button" className="icon-btn" title={t('terminal.external')} onClick={() => openTerminal(path)}>
            <ExternalLink size={14} />
          </button>
          <button type="button" className="icon-btn" title={t('terminal.hide')} onClick={() => toggleTerminal(path)}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={body} />
    </div>
  )
}
