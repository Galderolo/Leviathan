import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RotateCcw, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { openTerminal, toggleTerminal } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { restartTerminal, retheme, showTerminal } from '../terminals'
import { basename } from '../utils'

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

/** The repository's terminal, at the bottom of the graph or diff: a console of its own in the repository's folder. */
export function TerminalPanel({ path }: { path: string }) {
  const t = useT()
  const body = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(savedHeight)
  const themeSetting = useStore((s) => s.settings.theme)

  useEffect(() => showTerminal(path, body.current!), [path])
  // After App has applied the theme to the document.
  useEffect(() => {
    const frame = requestAnimationFrame(retheme)
    return () => cancelAnimationFrame(frame)
  }, [themeSetting])

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
        <span className="dim small">{basename(path)}</span>
        <div className="terminal-actions">
          <button
            type="button"
            className="icon-btn"
            title={t('terminal.restart')}
            onClick={() => restartTerminal(path)}
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
