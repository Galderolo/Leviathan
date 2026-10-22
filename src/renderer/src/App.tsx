import { useEffect, useState } from 'react'
import {
  autoFetchTick,
  closeDiff,
  closeFileView,
  closeTab,
  cycleTab,
  browseAndOpen,
  handleAskpass,
  handleProgress,
  initApp,
  newTab,
  redo,
  refreshRepo,
  saveSettings,
  undo
} from './actions'
import { CommitGraph } from './components/CommitGraph'
import { ContextMenu, Dialog, Resizer, Toasts } from './components/common'
import { DiffView } from './components/DiffView'
import { LeftPanel } from './components/LeftPanel'
import { RightPanel } from './components/RightPanel'
import { RebaseDialog } from './components/RebaseDialog'
import { FileView } from './components/FileViews'
import { SettingsModal } from './components/SettingsModal'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { WelcomeView } from './components/WelcomeView'
import { getRepo, useActiveTab, useStore } from './store'
import { resolveTheme } from './theme'
import { t } from './i18n'
import { toast } from './ui'

const api = window.leviathan

/** Shortcuts like Ctrl+Z must not steal the text editing ones of inputs. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
}

export function App() {
  const ready = useStore((s) => s.ready)
  const themeSetting = useStore((s) => s.settings.theme)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => (document.documentElement.dataset.theme = resolveTheme(themeSetting ?? 'system', media.matches))
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [themeSetting])
  const tab = useActiveTab()

  useEffect(() => {
    void initApp()
    const offChanged = api.onRepoChanged((e) => {
      if (getRepo(e.repo)) void refreshRepo(e.repo, { log: e.kind === 'git' })
    })
    const offProgress = api.onProgress((e) => handleProgress(e.repo, e.line))
    const offAskpass = api.onAskpass((e) => void handleAskpass(e))
    const offUpdate = api.onUpdate((update) => {
      const before = useStore.getState().update
      useStore.setState({ update })
      if (update.status === 'available' && update.version && before?.version !== update.version) {
        toast('info', t('update.available', { version: update.version }))
      }
      // Installing failed (the app is still here): say so once.
      if (update.status === 'ready' && update.error && update.error !== before?.error) {
        toast('error', t('update.installFailed', { error: update.error.split('\n')[0] }))
      }
    })
    void api.getUpdateState().then((update) => useStore.setState({ update }))
    const fetchTimer = window.setInterval(autoFetchTick, 30_000)
    const firstFetch = window.setTimeout(autoFetchTick, 5_000)
    const onFocus = () => {
      const s = useStore.getState()
      const active = s.tabs.find((x) => x.id === s.activeTab)
      if (active?.path) void refreshRepo(active.path)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      offChanged()
      offProgress()
      offAskpass()
      offUpdate()
      window.clearInterval(fetchTimer)
      window.clearTimeout(firstFetch)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      // A modal on top (dialog, menu, Settings, rebase): shortcuts must not act on the repository behind it.
      if (s.dialog || s.menu || s.settingsOpen || s.rebase) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const active = s.tabs.find((x) => x.id === s.activeTab)
      if (mod && key === 't') {
        e.preventDefault()
        newTab()
      } else if (mod && key === 'w') {
        e.preventDefault()
        if (s.activeTab) closeTab(s.activeTab)
      } else if (mod && e.key === 'Tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      } else if (mod && key === 'o') {
        e.preventDefault()
        void browseAndOpen(active?.path ? undefined : active?.id)
      } else if (mod && (key === 'z' || key === 'y') && active?.path && !isTyping(e.target)) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) void redo(active.path)
        else void undo(active.path)
      } else if (mod && key === 'f') {
        e.preventDefault()
        document.getElementById('graph-search')?.focus()
      } else if (e.key === 'F5' && active?.path) {
        e.preventDefault()
        void refreshRepo(active.path)
      } else if (e.key === 'Escape' && active?.path && getRepo(active.path)?.fileView && !isTyping(e.target)) {
        closeFileView(active.path)
      } else if (e.key === 'Escape' && active?.path && getRepo(active.path)?.diff) {
        const target = e.target as HTMLElement
        if (!['INPUT', 'TEXTAREA'].includes(target.tagName)) closeDiff(active.path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TabBar />
      {ready &&
        tab &&
        (tab.path ? <RepoScreen key={tab.path} path={tab.path} /> : <WelcomeView key={tab.id} tabId={tab.id} />)}
      <StatusBar />
      <ContextMenu />
      <SettingsModal />
      <RebaseDialog />
      <Dialog />
      <Toasts />
    </div>
  )
}

function RepoScreen({ path }: { path: string }) {
  const settings = useStore((s) => s.settings)
  const hasDiff = useStore((s) => !!s.repos[path]?.diff)
  const hasFileView = useStore((s) => !!s.repos[path]?.fileView)
  const [left, setLeft] = useState(settings.leftPanelWidth)
  const [right, setRight] = useState(settings.rightPanelWidth)

  return (
    <>
      <Toolbar path={path} />
      <div className="workspace">
        <div className="left-panel" style={{ width: left }}>
          <LeftPanel path={path} />
        </div>
        <Resizer
          value={left}
          min={160}
          max={520}
          onChange={setLeft}
          onCommit={(v) => void saveSettings({ leftPanelWidth: v })}
        />
        <div className="center-panel">
          {hasFileView ? <FileView path={path} /> : hasDiff ? <DiffView path={path} /> : <CommitGraph path={path} />}
        </div>
        <Resizer
          value={right}
          min={260}
          max={640}
          invert
          onChange={setRight}
          onCommit={(v) => void saveSettings({ rightPanelWidth: v })}
        />
        <div className="right-panel" style={{ width: right }}>
          <RightPanel path={path} />
        </div>
      </div>
    </>
  )
}
