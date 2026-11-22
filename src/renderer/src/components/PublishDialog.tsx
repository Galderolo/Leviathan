import { useEffect, useRef, useState, type Ref } from 'react'
import {
  canPublish,
  projectLocation,
  projectName,
  projectNameProblem,
  type ProjectNameProblem,
  type PublishInput
} from '../../../shared/publish'
import type { Account } from '../../../shared/types'
import { addRemote, closePublish, openAccountsSettings } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { errorMessage } from '../ui'
import { basename } from '../utils'
import { Spinner } from './common'

const api = window.leviathan

type Workspaces =
  { state: 'none' } | { state: 'loading' } | { state: 'ready'; slugs: string[] } | { state: 'error'; message: string }

/** What the publish fields hold and what they make: `input` is null while something blocks Publish. */
export interface PublishState {
  usable: Account[]
  account: Account | null
  accountId: string
  setAccountId: (id: string) => void
  workspace: string
  setWorkspace: (slug: string) => void
  workspaces: Workspaces
  name: string
  setName: (name: string) => void
  nameProblem: ProjectNameProblem | null
  description: string
  setDescription: (text: string) => void
  isPrivate: boolean
  setPrivate: (value: boolean) => void
  input: PublishInput | null
}

/**
 * The choices of a publish: the accounts that can create projects (`preferred` first picked when it is one of them),
 * the workspace on Bitbucket, and a name that follows `nameFrom` (a folder) until it is edited.
 */
export function usePublishChoice(accounts: Account[], nameFrom: string, preferred: string | null): PublishState {
  const usable = accounts.filter(canPublish)
  const [picked, setAccountId] = useState('')
  const accountId = usable.some((a) => a.id === picked)
    ? picked
    : (usable.find((a) => a.id === preferred)?.id ?? usable[0]?.id ?? '')
  const account = usable.find((a) => a.id === accountId) ?? null
  const [workspaces, setWorkspaces] = useState<Workspaces>({ state: 'none' })
  const [pickedWorkspace, setWorkspace] = useState('')
  const [typedName, setTypedName] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [isPrivate, setPrivate] = useState(true)

  const bitbucket = account?.provider === 'bitbucket'
  useEffect(() => {
    if (!bitbucket) {
      setWorkspaces({ state: 'none' })
      return
    }
    let alive = true
    setWorkspaces({ state: 'loading' })
    api
      .listAccountWorkspaces(accountId)
      .then((slugs) => alive && setWorkspaces({ state: 'ready', slugs }))
      .catch((err) => alive && setWorkspaces({ state: 'error', message: errorMessage(err) }))
    return () => {
      alive = false
    }
  }, [accountId, bitbucket])

  const slugs = workspaces.state === 'ready' ? workspaces.slugs : []
  const workspace = slugs.includes(pickedWorkspace) ? pickedWorkspace : (slugs[0] ?? '')
  const name = typedName ?? projectName(nameFrom)
  const nameProblem = projectNameProblem(name.trim())
  const blocked = !account || nameProblem !== null || (bitbucket && !workspace)
  const input: PublishInput | null =
    blocked || !account
      ? null
      : {
          accountId: account.id,
          name: name.trim(),
          description: description.trim(),
          private: isPrivate,
          ...(bitbucket ? { workspace } : {})
        }
  return {
    usable,
    account,
    accountId,
    setAccountId,
    workspace,
    setWorkspace,
    workspaces,
    name,
    setName: setTypedName,
    nameProblem,
    description,
    setDescription,
    isPrivate,
    setPrivate,
    input
  }
}

/** Account, workspace (Bitbucket), name, description and private: the Publish dialog's and the Welcome form's. */
export function PublishFields({
  publish,
  disabled,
  autoFocus,
  nameRef
}: {
  publish: PublishState
  disabled?: boolean
  autoFocus?: boolean
  nameRef?: Ref<HTMLInputElement>
}) {
  const t = useT()
  const { account, workspaces } = publish
  const bitbucket = account?.provider === 'bitbucket'
  return (
    <>
      <label className="field">
        <span>{t('publish.account')}</span>
        <select value={publish.accountId} disabled={disabled} onChange={(e) => publish.setAccountId(e.target.value)}>
          {publish.usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.username}@{a.host}
            </option>
          ))}
        </select>
      </label>
      {bitbucket && workspaces.state === 'loading' && (
        <div className="dim small">
          <Spinner size={12} /> {t('publish.loadingWorkspaces')}
        </div>
      )}
      {bitbucket && workspaces.state === 'error' && <div className="publish-problem">{workspaces.message}</div>}
      {bitbucket && workspaces.state === 'ready' && workspaces.slugs.length === 0 && (
        <div className="publish-problem">{t('publish.noWorkspaces')}</div>
      )}
      {bitbucket && workspaces.state === 'ready' && workspaces.slugs.length > 1 && (
        <label className="field">
          <span>{t('publish.workspace')}</span>
          <select value={publish.workspace} disabled={disabled} onChange={(e) => publish.setWorkspace(e.target.value)}>
            {workspaces.slugs.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>{t('publish.name')}</span>
        <input
          autoFocus={autoFocus}
          ref={nameRef}
          value={publish.name}
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => publish.setName(e.target.value)}
        />
      </label>
      {publish.nameProblem ? (
        <div className="publish-problem">{t(`publish.problem.${publish.nameProblem}`)}</div>
      ) : (
        account &&
        (account.provider !== 'bitbucket' || publish.workspace !== '') && (
          <div className="dim small">
            {t('publish.location', { where: projectLocation(account, publish.workspace, publish.name.trim()) })}
          </div>
        )
      )}
      <label className="field">
        <span>{t('publish.description')}</span>
        <input
          value={publish.description}
          disabled={disabled}
          onChange={(e) => publish.setDescription(e.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={publish.isPrivate}
          disabled={disabled}
          onChange={(e) => publish.setPrivate(e.target.checked)}
        />
        {t('publish.private')}
      </label>
    </>
  )
}

export function PublishDialog() {
  const publish = useStore((s) => s.publish)
  if (!publish) return null
  return <PublishForm key={publish.path} path={publish.path} />
}

/** Publishes the repository at `path`; a refusal stays in the dialog, so the name can be changed and tried again. */
function PublishForm({ path }: { path: string }) {
  const t = useT()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [preferred, setPreferred] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runningRef = useRef(false)
  runningRef.current = running
  const modalRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Focus starts in the dialog, not on the toolbar button behind it; the fields take it over once they show.
  useEffect(() => modalRef.current?.focus(), [])
  // A refusal re-enables the name: focus goes back to it.
  useEffect(() => {
    if (error && !running) nameRef.current?.focus()
  }, [error, running])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useStore.getState().dialog && !runningRef.current) closePublish(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let alive = true
    void Promise.all([api.listAccounts().catch(() => []), api.getRepoAccount(path).catch(() => null)]).then(
      ([list, bound]) => {
        if (!alive) return
        setPreferred(bound)
        setAccounts(list)
      }
    )
    return () => {
      alive = false
    }
  }, [path])

  const publish = usePublishChoice(accounts ?? [], basename(path), preferred)
  const none = accounts !== null && publish.usable.length === 0
  const cancel = () => !running && closePublish(null)
  const submit = async () => {
    if (!publish.input || running) return
    setRunning(true)
    setError(null)
    try {
      const published = await api.publishRepo(path, publish.input)
      // Only the dialog it was opened for takes the result.
      if (useStore.getState().publish?.path === path) closePublish(published)
    } catch (err) {
      setError(errorMessage(err))
      setRunning(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form
        ref={modalRef}
        tabIndex={-1}
        className="modal publish-modal"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="modal-title">{t('publish.title')}</div>
        {accounts === null && <Spinner size={14} />}
        {none && <p className="modal-message">{t('publish.noAccount')}</p>}
        {accounts !== null && !none && (
          <>
            <p className="modal-message">{t('publish.hint')}</p>
            <PublishFields publish={publish} disabled={running} autoFocus nameRef={nameRef} />
          </>
        )}
        {error && <div className="publish-problem">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={running} onClick={cancel}>
            {t('common.cancel')}
          </button>
          {none ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  closePublish(null)
                  void addRemote(path)
                }}
              >
                {t('publish.addRemote')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => {
                  closePublish(null)
                  openAccountsSettings()
                }}
              >
                {t('publish.addAccount')}
              </button>
            </>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!publish.input || running}>
              {running ? (
                <>
                  <Spinner size={12} /> {t('publish.publishing')}
                </>
              ) : (
                t('publish.submit')
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
