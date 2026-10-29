import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, UserRound } from 'lucide-react'
import { DEFAULT_HOSTS, PROVIDERS, tokenPageUrl } from '../../../shared/providers'
import type { Account, Provider } from '../../../shared/types'
import { openExternal, reloadAllPullRequests } from '../actions'
import { useT } from '../i18n'
import { confirmDialog, errorMessage, formDialog, toast } from '../ui'

const api = window.leviathan

export const PROVIDER_LABELS: Record<Provider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  gitea: 'Gitea',
  other: 'Other'
}

interface Draft {
  provider: Provider
  host: string
  token: string
  username: string
  name: string
  email: string
}

const emptyDraft = (): Draft => ({
  provider: 'github',
  host: DEFAULT_HOSTS.github,
  token: '',
  username: '',
  name: '',
  email: ''
})

export function AccountsSection() {
  const t = useT()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  // GitHub sign-in in progress: the code to enter in the browser ('starting' while it is requested).
  const [login, setLogin] = useState<{ userCode: string; verificationUri: string } | null | 'starting'>(null)
  // GitLab sign-in in progress: the page opened in the browser ('starting' while the app gets ready for it).
  const [gitlab, setGitlab] = useState<{ url: string } | null | 'starting'>(null)
  // Each sign-in (and each cancel) gets a new number: a cancelled one must not touch the next one's box.
  const attempt = useRef(0)

  const load = () =>
    api
      .listAccounts()
      .then(setAccounts)
      .catch((err) => toast('error', errorMessage(err)))
  // After adding or removing an account: open repositories may now see (or lose) their pull requests.
  const changed = async () => {
    await load()
    reloadAllPullRequests()
  }

  // An account added again is kept with the new token: say which of the two happened.
  const announce = (account: Account) =>
    toast(
      'success',
      t(accounts?.some((a) => a.id === account.id) ? 'accounts.renewed' : 'accounts.added', {
        name: `${account.username}@${account.host}`
      })
    )

  useEffect(() => {
    void load()
  }, [])

  // Closing Settings while waiting abandons the sign-in.
  useEffect(
    () => () => {
      attempt.current++
      void api.cancelGitHubLogin()
      void api.cancelGitLabLogin()
    },
    []
  )

  const signIn = async () => {
    const mine = ++attempt.current
    const current = () => attempt.current === mine
    setLogin('starting')
    try {
      const started = await api.startGitHubLogin()
      if (!current()) return
      setLogin(started)
      const account = await api.finishGitHubLogin()
      announce(account)
      await changed()
    } catch (err) {
      if (current() && !/cancelled/i.test(errorMessage(err))) toast('error', errorMessage(err))
    } finally {
      if (current()) setLogin(null)
    }
  }

  const cancelSignIn = () => {
    attempt.current++
    void api.cancelGitHubLogin()
    setLogin(null)
  }

  const signInGitLab = async () => {
    const mine = ++attempt.current
    const current = () => attempt.current === mine
    setGitlab('starting')
    try {
      const started = await api.startGitLabLogin()
      if (!current()) return
      setGitlab(started)
      openExternal(started.url)
      const account = await api.finishGitLabLogin()
      announce(account)
      await changed()
    } catch (err) {
      if (current() && !/cancelled/i.test(errorMessage(err))) toast('error', errorMessage(err))
    } finally {
      if (current()) setGitlab(null)
    }
  }

  const cancelGitLab = () => {
    attempt.current++
    void api.cancelGitLabLogin()
    setGitlab(null)
  }

  const label = (p: Provider) => (p === 'other' ? t('accounts.other') : PROVIDER_LABELS[p])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const account = await api.addAccount({
        provider: draft.provider,
        host: draft.host,
        token: draft.token,
        username: draft.username || undefined,
        name: draft.name || undefined,
        email: draft.email || undefined
      })
      announce(account)
      setDraft(null)
      await changed()
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const edit = async (account: Account) => {
    const values = await formDialog({
      title: `${account.username}@${account.host}`,
      confirmText: t('common.save'),
      fields: [
        { key: 'name', label: t('accounts.name'), value: account.name },
        { key: 'email', label: t('accounts.email'), value: account.email }
      ]
    })
    if (!values) return
    await api.updateAccount(account.id, { name: values.name.trim(), email: values.email.trim() }).catch((err) => {
      toast('error', errorMessage(err))
    })
    await load()
  }

  const remove = async (account: Account) => {
    const ok = await confirmDialog({
      title: t('accounts.remove'),
      message: t('accounts.removeConfirm', { name: `${account.username}@${account.host}` }),
      confirmText: t('accounts.remove'),
      danger: true
    })
    if (!ok) return
    await api.removeAccount(account.id).catch((err) => toast('error', errorMessage(err)))
    await changed()
  }

  const tokenUrl = draft && draft.host ? tokenPageUrl(draft.provider, draft.host) : null

  return (
    <div className="ssh-section">
      <div className="ssh-title">{t('accounts.title')}</div>
      {accounts && accounts.length === 0 && !draft && <div className="dim small">{t('accounts.none')}</div>}
      {accounts?.map((account) => (
        <div key={account.id} className="ssh-key">
          <UserRound size={14} className="dim" />
          <div className="ssh-key-text">
            <span>
              {account.username}@{account.host} <span className="dim small">· {label(account.provider)}</span>
            </span>
            <span className="dim small">
              {account.name} &lt;{account.email}&gt;
            </span>
          </div>
          <button
            type="button"
            className="icon-btn small"
            title={t('accounts.edit')}
            onClick={() => void edit(account)}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="icon-btn small"
            title={t('accounts.remove')}
            onClick={() => void remove(account)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {draft ? (
        <div className="account-form">
          <div className="input-row">
            <select
              value={draft.provider}
              onChange={(e) => {
                const provider = e.target.value as Provider
                setDraft({ ...draft, provider, host: DEFAULT_HOSTS[provider] })
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </select>
            <input
              placeholder={t('accounts.host')}
              value={draft.host}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            />
          </div>
          {(draft.provider === 'other' || draft.provider === 'bitbucket') && (
            <input
              placeholder={
                draft.provider === 'bitbucket'
                  ? `${t('accounts.bitbucketUsername')} (${t('accounts.optional')})`
                  : t('accounts.username')
              }
              value={draft.username}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            />
          )}
          <input
            type="password"
            placeholder={draft.provider === 'bitbucket' ? t('accounts.apiToken') : t('accounts.token')}
            value={draft.token}
            onChange={(e) => setDraft({ ...draft, token: e.target.value })}
          />
          <div className="input-row">
            <input
              placeholder={`${t('accounts.name')} (${t('accounts.optional')})`}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              placeholder={`${t('accounts.email')} (${t('accounts.optional')})`}
              value={draft.email}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </div>
          {draft.provider === 'bitbucket' && <div className="dim small">{t('accounts.bitbucketHint')}</div>}
          <div className="dim small">
            {draft.provider === 'bitbucket' ? t('accounts.bitbucketTokenHint') : t('accounts.tokenHint')}
          </div>
          <div className="ssh-actions">
            {tokenUrl && <a onClick={() => openExternal(tokenUrl)}>{t('accounts.createToken')}</a>}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn small" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn small btn-primary"
              disabled={saving || !draft.host.trim() || !draft.token.trim()}
              onClick={() => void save()}
            >
              {t('dlg.add')}
            </button>
          </div>
        </div>
      ) : gitlab ? (
        <div className="account-form device-login">
          <div className="small">{t('accounts.gitlabHint')}</div>
          <div className="dim small">{t('accounts.waiting')}</div>
          <div className="ssh-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="btn small" onClick={cancelGitLab}>
              {t('common.cancel')}
            </button>
            {gitlab !== 'starting' && (
              <button type="button" className="btn small btn-primary" onClick={() => openExternal(gitlab.url)}>
                {t('accounts.openAgain')}
              </button>
            )}
          </div>
        </div>
      ) : login ? (
        <div className="account-form device-login">
          {login === 'starting' ? (
            <div className="dim small">{t('accounts.signInStarting')}</div>
          ) : (
            <>
              <div className="small">{t('accounts.deviceHint')}</div>
              <div className="device-code">{login.userCode}</div>
              <div className="dim small">{t('accounts.waiting')}</div>
            </>
          )}
          <div className="ssh-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="btn small" onClick={cancelSignIn}>
              {t('common.cancel')}
            </button>
            {login !== 'starting' && (
              <button
                type="button"
                className="btn small btn-primary"
                onClick={() => {
                  void navigator.clipboard.writeText(login.userCode).catch(() => {})
                  openExternal(login.verificationUri)
                }}
              >
                {t('accounts.copyAndOpen')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="ssh-actions">
            <button type="button" className="btn small btn-primary" onClick={() => void signIn()}>
              {t('accounts.signInGitHub')}
            </button>
            <button type="button" className="btn small btn-primary" onClick={() => void signInGitLab()}>
              {t('accounts.signInGitLab')}
            </button>
            <button type="button" className="btn small" onClick={() => setDraft(emptyDraft())}>
              {t('accounts.add')}
            </button>
          </div>
          <div className="dim small">{t('accounts.ownServerHint')}</div>
        </>
      )}
    </div>
  )
}
