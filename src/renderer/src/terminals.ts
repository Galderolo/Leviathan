import type { FitAddon } from '@xterm/addon-fit'
import type { ITheme, Terminal } from '@xterm/xterm'
import { t } from './i18n'
import { terminalKey } from './shortcuts'
import { getRepo, patchRepo, useStore } from './store'
import { opensLink, terminalFontSize } from './terminalTabs'
import { toast } from './ui'

const api = window.leviathan

/**
 * One of a repository's consoles. It lives on while its panel is hidden, another of its tabs shows or another
 * repository does: what it ran and printed is there when it shows again.
 */
interface Session {
  key: number
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

/** By console key (the tab's), not the main process's id: a console started again keeps its tab. */
const sessions = new Map<number, Session>()
const byId = new Map<number, Session>()
let lastKey = 0
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
    const { id, shell } = await api.terminalStart(session.repo, session.term.cols, session.term.rows)
    session.id = id
    byId.set(id, session)
    patchRepo(session.repo, (r) => ({ consoles: r.consoles.map((c) => (c.key === session.key ? { ...c, shell } : c)) }))
    const before = early.get(id)
    early.delete(id)
    if (before) session.term.write(before)
  } catch (err) {
    session.ended = true
    session.term.write(`\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`)
  }
}

async function create(repo: string, key: number): Promise<Session> {
  const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-web-links')
  ])
  const css = getComputedStyle(document.documentElement)
  const term = new Terminal({
    fontFamily: css.getPropertyValue('--mono').trim() || 'monospace',
    fontSize: terminalFontSize(useStore.getState().settings.terminalFontSize),
    cursorBlink: true,
    scrollback: 5000,
    theme: theme()
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const host = document.createElement('div')
  host.className = 'terminal-host'
  const session: Session = { key, repo, term, fit, host, opened: false, id: null, ended: false }
  const mac = api.platform === 'darwin'
  // URLs in the output (the one `git push` prints to open a pull request): Ctrl+click opens them in the browser.
  term.loadAddon(
    new WebLinksAddon(
      (event, uri) => {
        if (opensLink(event, mac)) void api.openExternal(uri).catch(() => {})
      },
      {
        hover: () => (host.title = t(mac ? 'terminal.followLinkMac' : 'terminal.followLink')),
        leave: () => (host.title = '')
      }
    )
  )
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

/** Opens a new console for the repository, in a tab of its own that shows at once. */
export function addConsole(repo: string): void {
  const key = ++lastKey
  patchRepo(repo, (r) => ({ consoles: [...r.consoles, { key, shell: '' }], activeConsole: key, terminalOpen: true }))
}

/**
 * Shows console `key` of the repository in `container`, starting it the first time. Returns what hides it again (the
 * console goes on).
 */
export function showConsole(repo: string, key: number, container: HTMLElement): () => void {
  listen()
  let gone = false
  let observer: ResizeObserver | null = null
  let shown: Session | null = null
  const pending = sessions.get(key) ?? null
  void (async () => {
    let session = pending
    if (!session) {
      session = await create(repo, key)
      // Shown twice at once (a quick toggle): the first one made is kept.
      session = sessions.get(key) ?? session
      sessions.set(key, session)
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

/** Starts console `key` again: what runs in it now is ended. */
export function restartConsole(key: number): void {
  const session = sessions.get(key)
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

function endSession(session: Session): void {
  sessions.delete(session.key)
  if (session.id !== null) {
    byId.delete(session.id)
    void api.terminalStop(session.id)
  }
  session.term.dispose()
  session.host.remove()
}

/** Closes console `key` (what runs in it ends): the next tab shows, and the panel hides with the last one. */
export function closeConsole(repo: string, key: number): void {
  const session = sessions.get(key)
  if (session) endSession(session)
  const consoles = getRepo(repo)?.consoles ?? []
  const at = consoles.findIndex((c) => c.key === key)
  const left = consoles.filter((c) => c.key !== key)
  patchRepo(repo, (r) => ({
    consoles: left,
    activeConsole: r.activeConsole === key ? (left[Math.min(at, left.length - 1)]?.key ?? null) : r.activeConsole,
    terminalOpen: left.length > 0 && r.terminalOpen
  }))
}

/** The repository's tab closed: its consoles end, and are forgotten. */
export function closeTerminal(repo: string): void {
  for (const session of [...sessions.values()]) if (session.repo === repo) endSession(session)
}

/** The app's theme changed: so do the consoles' colours. */
export function retheme(): void {
  for (const session of sessions.values()) session.term.options.theme = theme()
}

/** The font size in Settings changed: the consoles take it, and fit their panel again. */
export function setTerminalFontSize(size: number): void {
  for (const session of sessions.values()) {
    session.term.options.fontSize = terminalFontSize(size)
    fitTo(session)
  }
}
