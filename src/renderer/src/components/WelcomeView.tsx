import { useState } from 'react'
import { ArrowLeft, Download, FolderOpen, FolderPlus, X } from 'lucide-react'
import { browseAndOpen, cloneRepository, initRepository, openRepository, removeRecent, saveSettings } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { errorMessage, toast } from '../ui'
import { basename } from '../utils'
import { Spinner } from './common'

type Mode = 'home' | 'clone' | 'init'

const api = window.calamar

function joinPath(parent: string, child: string): string {
  if (!parent) return child
  const sep = parent.includes('\\') ? '\\' : '/'
  return parent.replace(/[\\/]+$/, '') + sep + child
}

function folderFromUrl(url: string): string {
  const clean = url
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\.git$/, '')
  return (
    clean
      .split(/[\\/:]/)
      .filter(Boolean)
      .pop() ?? ''
  )
}

export function WelcomeView({ tabId }: { tabId: string }) {
  const t = useT()
  const [mode, setMode] = useState<Mode>('home')
  const recent = useStore((s) => s.settings.recentRepos)

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <img src="./calamar.svg" alt="" width={64} height={64} />
          <div>
            <h1>Calamar</h1>
            <p className="dim">{t('welcome.tagline')}</p>
          </div>
        </div>

        {mode === 'home' && (
          <>
            <div className="welcome-actions">
              <button className="welcome-card" onClick={() => void browseAndOpen(tabId)}>
                <FolderOpen size={26} />
                <span>{t('welcome.open')}</span>
              </button>
              <button className="welcome-card" onClick={() => setMode('clone')}>
                <Download size={26} />
                <span>{t('welcome.clone')}</span>
              </button>
              <button className="welcome-card" onClick={() => setMode('init')}>
                <FolderPlus size={26} />
                <span>{t('welcome.init')}</span>
              </button>
            </div>
            <div className="recent">
              <div className="recent-title">{t('welcome.recent')}</div>
              {recent.length === 0 && <div className="dim">{t('welcome.noRecent')}</div>}
              {recent.map((repo) => (
                <div
                  key={repo}
                  className="recent-row"
                  onClick={() => openRepository(repo, tabId).catch((err) => toast('error', errorMessage(err)))}
                >
                  <span className="recent-name">{basename(repo)}</span>
                  <span className="recent-path dim">{repo}</span>
                  <button
                    className="icon-btn small"
                    title={t('welcome.removeRecent')}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeRecent(repo)
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {mode === 'clone' && <CloneForm tabId={tabId} onBack={() => setMode('home')} />}
        {mode === 'init' && <InitForm tabId={tabId} onBack={() => setMode('home')} />}
      </div>
    </div>
  )
}

function CloneForm({ tabId, onBack }: { tabId: string; onBack: () => void }) {
  const t = useT()
  const cloneDir = useStore((s) => s.settings.cloneDir)
  const progress = useStore((s) => s.cloneProgress)
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(cloneDir)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const folder = nameTouched ? name : folderFromUrl(url)
  const dest = parent && folder ? joinPath(parent, folder) : ''
  const busy = progress !== null

  return (
    <form
      className="welcome-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!url.trim() || !dest) return
        void saveSettings({ cloneDir: parent })
        await cloneRepository(url.trim(), dest, tabId)
      }}
    >
      <FormTitle title={t('welcome.clone')} onBack={onBack} />
      <label className="field">
        <span>{t('clone.url')}</span>
        <input
          autoFocus
          value={url}
          placeholder="https://github.com/user/repo.git"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('clone.parent')}</span>
        <div className="input-row">
          <input value={parent} spellCheck={false} onChange={(e) => setParent(e.target.value)} />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const dir = await api.pickFolder(t('clone.parent'))
              if (dir) setParent(dir)
            }}
          >
            {t('clone.browse')}
          </button>
        </div>
      </label>
      <label className="field">
        <span>{t('clone.folderName')}</span>
        <input
          value={folder}
          spellCheck={false}
          onChange={(e) => {
            setNameTouched(true)
            setName(e.target.value)
          }}
        />
      </label>
      {dest && <div className="dim small">{t('clone.fullPath', { path: dest })}</div>}
      <div className="form-actions">
        {busy && (
          <span className="clone-progress dim">
            <Spinner size={12} /> {progress}
          </span>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !url.trim() || !dest}>
          {busy ? t('clone.cloning') : t('clone.submit')}
        </button>
      </div>
    </form>
  )
}

function InitForm({ tabId, onBack }: { tabId: string; onBack: () => void }) {
  const t = useT()
  const [folder, setFolder] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)

  return (
    <form
      className="welcome-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!folder.trim() || !branch.trim()) return
        setBusy(true)
        await initRepository(folder.trim(), branch.trim(), tabId)
        setBusy(false)
      }}
    >
      <FormTitle title={t('welcome.init')} onBack={onBack} />
      <label className="field">
        <span>{t('init.folder')}</span>
        <div className="input-row">
          <input autoFocus value={folder} spellCheck={false} onChange={(e) => setFolder(e.target.value)} />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const dir = await api.pickFolder(t('init.folder'))
              if (dir) setFolder(dir)
            }}
          >
            {t('clone.browse')}
          </button>
        </div>
      </label>
      <label className="field">
        <span>{t('init.branch')}</span>
        <input value={branch} spellCheck={false} onChange={(e) => setBranch(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !folder.trim() || !branch.trim()}>
          {t('init.submit')}
        </button>
      </div>
    </form>
  )
}

function FormTitle({ title, onBack }: { title: string; onBack: () => void }) {
  const t = useT()
  return (
    <div className="form-title">
      <button type="button" className="icon-btn" title={t('common.back')} onClick={onBack}>
        <ArrowLeft size={16} />
      </button>
      <span>{title}</span>
    </div>
  )
}
