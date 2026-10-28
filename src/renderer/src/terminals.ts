import type { FitAddon } from '@xterm/addon-fit'
import type { ITheme, Terminal } from '@xterm/xterm'
import { t } from './i18n'
import { terminalKey } from './shortcuts'
import { toast } from './ui'

const api = window.leviathan

/**
 * A repository's console. It lives on while its panel is hidden or another tab shows: what it ran and printed is there
 * when it shows again.
 */
interface Session {
  repo: string
  term: Terminal
  fit: FitAddon
  /** What the terminal draws into, moved into the panel each time it shows. */
  host: HTMLDivElement
  opened: boolean
  /** The console's id in the main process; null before it starts and once it ended. */
  id: number | null
  ended: boolean
}

const sessions = new Map<string, Session>()
const byId = new Map<number, Session>()
/** Output of a console whose id the window does not know yet (it comes as the start answers). */
const early = new Map<number, string>()
let listening = false

function listen(): void {
  if (listening) return
  listening = true
  api.onTerminalData(({ id, data }) => {
    const session = byId.get(id)
    if (session) session.term.write(data)
    else early.set(id, (early.get(id) ?? '') + data)
  })
  api.onTerminalExit(({ id, code }) => {
    const session = byId.get(id)
    early.delete(id)
    if (!session) return
    byId.delete(id)
    session.id = null
    session.ended = true
    session.term.write(`\r\n\x1b[2m${t('terminal.ended', { code })}\x1b[0m\r\n`)
  })
}

// The colours programs print with, readable on each theme's background (VS Code's).
const DARK_COLOURS: ITheme = {
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
}
const LIGHT_COLOURS: ITheme = {
  black: '#000000',
  red: '#cd3131',
  green: '#107c10',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5'
}

/** The app's colours, read from its theme. */
function theme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    ...(document.documentElement.dataset.theme === 'light' ? LIGHT_COLOURS : DARK_COLOURS),
    background: v('--bg-0'),
    foreground: v('--text'),
    cursor: v('--accent'),
    cursorAccent: v('--bg-0'),
    selectionBackground: `${v('--accent')}55`
  }
}

async function start(session: Session): Promise<void> {
  session.ended = false
  try {
    const id = await api.terminalStart(session.repo, session.term.cols, session.term.rows)
    session.id = id
    byId.set(id, session)
    const before = early.get(id)
    early.delete(id)
    if (before) session.term.write(before)
  } catch (err) {
    session.ended = true
    session.term.write(`\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`)
  }
}

async function create(repo: string): Promise<Session> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
  const css = getComputedStyle(document.documentElement)
  const term = new Terminal({
    fontFamily: css.getPropertyValue('--mono').trim() || 'monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    theme: theme()
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const host = document.createElement('div')
  host.className = 'terminal-host'
  const session: Session = { repo, term, fit, host, opened: false, id: null, ended: false }
  const mac = api.platform === 'darwin'
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const key = terminalKey(e, mac, term.hasSelection())
    if (key === 'copy') {
      void navigator.clipboard.writeText(term.getSelection()).catch(() => {})
      term.clearSelection()
    } else if (key === 'paste') {
      void navigator.clipboard.readText().then(
        (text) => term.paste(text),
        () => {}
      )
    }
    // The app's own (copy, paste, hide the panel): not for the shell.
    return key === null
  })
  term.onData((data) => {
    // Ended: any key starts the console again.
    if (session.ended) void start(session)
    else if (session.id !== null) void api.terminalWrite(session.id, data)
  })
  term.onResize(({ cols, rows }) => {
    if (session.id !== null) void api.terminalResize(session.id, cols, rows)
  })
  return session
}

/** Fits the console to its panel, when the panel has a size. */
function fitTo(session: Session): void {
  if (session.host.isConnected && session.host.clientHeight > 0) session.fit.fit()
}

/**
 * Shows the repository's console in `container`, starting it the first time. Returns what hides it again (the
 * console goes on).
 */
export function showTerminal(repo: string, container: HTMLElement): () => void {
  listen()
  let gone = false
  let observer: ResizeObserver | null = null
  let shown: Session | null = null
  const pending = sessions.get(repo) ?? null
  void (async () => {
    let session = pending
    if (!session) {
      session = await create(repo)
      // Two panels for one repository at once (a quick toggle): the first one made is kept.
      session = sessions.get(repo) ?? session
      sessions.set(repo, session)
    }
    if (gone) return
    shown = session
    container.appendChild(session.host)
    if (!session.opened) {
      session.term.open(session.host)
      session.opened = true
    }
    fitTo(session)
    observer = new ResizeObserver(() => fitTo(session))
    observer.observe(container)
    if (session.id === null && !session.ended) await start(session)
    if (!gone) session.term.focus()
  })().catch((err) => toast('error', err instanceof Error ? err.message : String(err)))
  return () => {
    gone = true
    observer?.disconnect()
    shown?.host.remove()
  }
}

/** Starts the repository's console again: what runs in it now is ended. */
export function restartTerminal(repo: string): void {
  const session = sessions.get(repo)
  if (!session) return
  if (session.id !== null) {
    // Its end is not news: a new one starts right away.
    byId.delete(session.id)
    void api.terminalStop(session.id)
    session.id = null
  }
  session.term.reset()
  void start(session)
  session.term.focus()
}

/** The repository's tab closed: its console ends, and is forgotten. */
export function closeTerminal(repo: string): void {
  const session = sessions.get(repo)
  if (!session) return
  sessions.delete(repo)
  if (session.id !== null) {
    byId.delete(session.id)
    void api.terminalStop(session.id)
  }
  session.term.dispose()
  session.host.remove()
}

/** The app's theme changed: so do the consoles' colours. */
export function retheme(): void {
  for (const session of sessions.values()) session.term.options.theme = theme()
}
