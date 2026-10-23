import { useEffect, useState } from 'react'
import { Check, ExternalLink, GitMerge, X } from 'lucide-react'
import { mergeMethods } from '../../../shared/providers'
import type { FileChange, FileDiff, PullRequest, PullRequestComment } from '../../../shared/types'
import { approveReviewedPullRequest, closeReview, mergeReviewedPullRequest, openExternal } from '../actions'
import { useT } from '../i18n'
import { useRepo, useStore } from '../store'
import { errorMessage, toast } from '../ui'
import { cx, relativeDate, splitPath } from '../utils'
import { StatusBadge } from './common'
import { DiffLayoutToggle } from './DiffLines'
import { ReadOnlyDiff } from './FileViews'

const api = window.leviathan

/** The pull request under review, in the center panel. */
export function PullRequestView({ path }: { path: string }) {
  const pr = useRepo(path)?.review
  if (!pr) return null
  return <Review key={pr.url} path={path} pr={pr} />
}

function Review({ path, pr }: { path: string; pr: PullRequest }) {
  const t = useT()
  const provider = useRepo(path)?.pullRequests?.provider ?? null
  const [range, setRange] = useState<{ base: string; head: string; files: FileChange[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'files' | 'conversation'>('files')
  const [picked, setPicked] = useState<FileChange | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [comments, setComments] = useState<PullRequestComment[] | null>(null)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    const { number, sourceBranch, targetBranch, fromFork } = pr
    api
      .reviewPullRequest(path, { number, sourceBranch, targetBranch, fromFork })
      .then((r) => {
        if (!live) return
        setRange(r)
        setPicked(r.files[0] ?? null)
      })
      .catch((err) => live && setError(errorMessage(err)))
    api
      .getPullRequestComments(path, pr.number)
      .then((list) => live && setComments(list))
      .catch((err) => live && setCommentsError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, pr])

  useEffect(() => {
    if (!range || !picked) return
    let live = true
    setDiff(null)
    setDiffError(null)
    api
      .getDiff(path, {
        kind: 'commit',
        hash: range.head,
        parent: range.base,
        path: picked.path,
        oldPath: picked.origPath
      })
      .then((d) => live && setDiff(d))
      .catch((err) => live && setDiffError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [path, range, picked])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  const showFile = (file: string) => {
    const found = range?.files.find((f) => f.path === file)
    if (!found) return
    setPicked(found)
    setTab('files')
  }

  return (
    <div className="diff-view file-view review-view">
      <div className="diff-header">
        <div className="diff-title">
          <span className="diff-context">{t('review.title')}</span>
          <span className="file-name">
            #{pr.number} {pr.title}
          </span>
        </div>
        <div className="diff-actions">
          {tab === 'files' && <DiffLayoutToggle />}
          <button className="btn small" onClick={() => openExternal(pr.url)}>
            <ExternalLink size={13} /> {t('review.openInBrowser')}
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => void run(() => approveReviewedPullRequest(path, pr))}
          >
            <Check size={13} /> {t('review.approve')}
          </button>
          <button
            className="btn small btn-primary"
            disabled={busy || !provider}
            onClick={() => provider && void run(() => mergeReviewedPullRequest(path, pr, mergeMethods(provider)))}
          >
            <GitMerge size={13} /> {t('review.merge')}
          </button>
          <button className="icon-btn" title={`${t('diff.close')} (Esc)`} onClick={() => closeReview(path)}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="review-meta">
        <span>{pr.author}</span>
        <span className="dim">·</span>
        <code>{pr.sourceBranch}</code>
        <span className="dim">→</span>
        <code>{pr.targetBranch}</code>
        {pr.draft && <span className="review-draft">{t('review.draft')}</span>}
        <span className="review-tabs">
          <button className={cx('review-tab', tab === 'files' && 'active')} onClick={() => setTab('files')}>
            {t('review.files', { count: range?.files.length ?? '…' })}
          </button>
          <button
            className={cx('review-tab', tab === 'conversation' && 'active')}
            onClick={() => setTab('conversation')}
          >
            {t('review.conversation', { count: comments?.length ?? '…' })}
          </button>
        </span>
      </div>
      {tab === 'files' ? (
        <>
          {error && <div className="empty-state error">{error}</div>}
          {!error && !range && <div className="empty-state">{t('review.fetching')}</div>}
          {range && range.files.length === 0 && <div className="empty-state">{t('review.noFiles')}</div>}
          {range && range.files.length > 0 && (
            <div className="history-layout">
              <div className="history-list">
                {range.files.map((file) => {
                  const { dir, name } = splitPath(file.path)
                  return (
                    <div
                      key={file.path}
                      className={cx('file-row', picked?.path === file.path && 'active')}
                      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
                      onClick={() => setPicked(file)}
                    >
                      <StatusBadge status={file.status} />
                      <span className="file-path">
                        <span className="file-dir">{dir}</span>
                        <span className="file-name">{name}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="diff-body">
                {diffError && <div className="empty-state error">{diffError}</div>}
                {!diffError && !diff && <div className="empty-state">{t('graph.loading')}</div>}
                {diff && <ReadOnlyDiff data={diff} />}
              </div>
            </div>
          )}
        </>
      ) : (
        <Conversation
          path={path}
          pr={pr}
          comments={comments}
          error={commentsError}
          onAdded={(comment) => setComments((list) => [...(list ?? []), comment])}
          onShowFile={showFile}
        />
      )}
    </div>
  )
}

/** How long ago a provider's timestamp was; nothing for one that does not parse (formatting it would throw). */
function when(createdAt: string, lang: string): string {
  const ms = Date.parse(createdAt)
  return Number.isFinite(ms) ? relativeDate(ms / 1000, lang) : ''
}

function Conversation(props: {
  path: string
  pr: PullRequest
  comments: PullRequestComment[] | null
  error: string | null
  onAdded: (comment: PullRequestComment) => void
  onShowFile: (file: string) => void
}) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!draft.trim()) return
    setSending(true)
    try {
      props.onAdded(await api.commentOnPullRequest(props.path, props.pr.number, draft))
      setDraft('')
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="review-conversation">
      {props.error && <div className="empty-state error">{props.error}</div>}
      {!props.error && !props.comments && <div className="empty-state">{t('graph.loading')}</div>}
      {props.comments?.length === 0 && <div className="empty-state">{t('review.noComments')}</div>}
      {props.comments?.map((comment) => (
        <div key={comment.id} className="review-comment">
          <div className="review-comment-head">
            <strong>{comment.author}</strong>
            <span className="dim small">{when(comment.createdAt, lang)}</span>
            {comment.path && (
              <a className="review-comment-file" onClick={() => props.onShowFile(comment.path!)}>
                {comment.path}
                {comment.line ? `:${comment.line}` : ''}
              </a>
            )}
          </div>
          <div className="review-comment-body">{comment.body}</div>
        </div>
      ))}
      <div className="review-reply">
        <textarea
          rows={3}
          placeholder={t('review.commentPlaceholder')}
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send()
          }}
        />
        <button className="btn small btn-primary" disabled={sending || !draft.trim()} onClick={() => void send()}>
          {t('review.comment')}
        </button>
      </div>
    </div>
  )
}
