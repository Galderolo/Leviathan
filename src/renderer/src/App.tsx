import { useEffect, useState } from 'react'
import {
  closeDiff,
  closeTab,
  cycleTab,
  browseAndOpen,
  handleAskpass,
  handleProgress,
  initApp,
  newTab,
  refreshRepo,
  saveSettings
} from './actions'
import { CommitGraph } from './components/CommitGraph'
import { ContextMenu, Dialog, Resizer, Toasts } from './components/common'
import { DiffView } from './components/DiffView'
import { LeftPanel } from './components/LeftPanel'
import { RightPanel } from './components/RightPanel'
import { SettingsModal } from './components/SettingsModal'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { WelcomeView } from './components/WelcomeView'
import { getRepo, useActiveTab, useStore } from './store'

const api = window.leviathan

export function App() {
  const ready = useStore((s) => s.ready)
  const tab = useActiveTab()

  useEffect(() => {
    void initApp()
    const offChanged = api.onRepoChanged((e) => {
      if (getRepo(e.repo)) void refreshRepo(e.repo, { log: e.kind === 'git' })
    })
    const offProgress = api.onProgress((e) => handleProgress(e.repo, e.line))
    const offAskpass = api.onAskpass((e) => void handleAskpass(e))
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
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (s.dialog || s.menu) return
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
      } else if (mod && key === 'f') {
        e.preventDefault()
        document.getElementById('graph-search')?.focus()
      } else if (e.key === 'F5' && active?.path) {
        e.preventDefault()
        void refreshRepo(active.path)
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
      <Dialog />
      <Toasts />
    </div>
  )
}

function RepoScreen({ path }: { path: string }) {
  const settings = useStore((s) => s.settings)
  const hasDiff = useStore((s) => !!s.repos[path]?.diff)
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
        <div className="center-panel">{hasDiff ? <DiffView path={path} /> : <CommitGraph path={path} />}</div>
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
