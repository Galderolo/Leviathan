import { useEffect, useState } from 'react'
import changelog from '../../../../CHANGELOG.md?raw'
import {
  compareVersions,
  inlineSpans,
  noteBlocks,
  parseChangelog,
  type ReleaseNote
} from '../../../shared/releaseNotes'
import { loadReleaseNotes, openExternal } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { Spinner } from './common'

/** The notes of every version, from GitHub (pre-releases included), or those shipped with the app when offline. */
export function WhatsNew() {
  const open = useStore((s) => s.whatsNewOpen)
  const installed = useStore((s) => s.versions.app)
  const t = useT()
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!open) return
    let current = true
    setNotes(null)
    loadReleaseNotes().then(
      (fetched) => {
        if (!current) return
        setNotes(fetched)
        setOffline(false)
      },
      () => {
        if (!current) return
        setNotes(parseChangelog(changelog))
        setOffline(true)
      }
    )
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      current = false
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide whats-new" role="dialog" aria-label={t('whatsNew.title')}>
        <div className="modal-title">{t('whatsNew.title')}</div>
        {offline && <div className="dim small">{t('whatsNew.offline')}</div>}
        <div className="whats-new-list">
          {!notes && (
            <div className="dim">
              <Spinner size={12} /> {t('graph.loading')}
            </div>
          )}
          {notes?.length === 0 && <div className="dim">{t('whatsNew.empty')}</div>}
          {notes?.map((note) => (
            <section key={note.version} className="release">
              <div className="release-header">
                <span className="release-version">{note.version}</span>
                {note.date && <span className="dim small">{note.date}</span>}
                {note.prerelease && <span className="release-tag">{t('whatsNew.prerelease')}</span>}
                {note.version === installed && <span className="release-tag installed">{t('whatsNew.installed')}</span>}
                {installed && compareVersions(note.version, installed) > 0 && (
                  <span className="release-tag newer">{t('whatsNew.newer')}</span>
                )}
                {note.url && (
                  <a className="release-link small" onClick={() => openExternal(note.url!)}>
                    {t('whatsNew.onGitHub')}
                  </a>
                )}
              </div>
              <NoteBody body={note.body} />
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function close(): void {
  useStore.setState({ whatsNewOpen: false })
}

function NoteBody({ body }: { body: string }) {
  return (
    <div className="release-body">
      {noteBlocks(body).map((block, i) =>
        block.kind === 'heading' ? (
          <div key={i} className="release-heading">
            <Inline text={block.text} />
          </div>
        ) : block.kind === 'item' ? (
          <div key={i} className="release-item" style={{ marginLeft: block.depth * 16 }}>
            <span className="release-bullet">•</span>
            <span>
              <Inline text={block.text} />
            </span>
          </div>
        ) : (
          <p key={i}>
            <Inline text={block.text} />
          </p>
        )
      )}
    </div>
  )
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineSpans(text).map((span, i) => {
        switch (span.kind) {
          case 'code':
            return <code key={i}>{span.text}</code>
          case 'strong':
            return <strong key={i}>{span.text}</strong>
          case 'em':
            return <em key={i}>{span.text}</em>
          case 'link':
            return (
              <a key={i} onClick={() => openExternal(span.href)} title={span.href}>
                {span.text}
              </a>
            )
          default:
            return <span key={i}>{span.text}</span>
        }
      })}
    </>
  )
}
