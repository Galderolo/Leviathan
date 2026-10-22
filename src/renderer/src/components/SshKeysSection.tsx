import { useEffect, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import type { SshKey } from '../../../shared/types'
import { openExternal } from '../actions'
import { useT } from '../i18n'
import { copyText, errorMessage, formDialog, toast } from '../ui'
import { basename } from '../utils'

const api = window.leviathan

const GITHUB_SSH_URL = 'https://github.com/settings/ssh/new'
const GITLAB_SSH_URL = 'https://gitlab.com/-/user_settings/ssh_keys'

export function SshKeysSection() {
  const t = useT()
  const [keys, setKeys] = useState<SshKey[] | null>(null)
  // Folded by default: the list is harmless (public keys) but people sharing their screen prefer not to show it.
  const [shown, setShown] = useState(false)

  const load = () =>
    api
      .listSshKeys()
      .then(setKeys)
      .catch((err) => toast('error', errorMessage(err)))

  useEffect(() => {
    void load()
  }, [])

  const generate = async () => {
    const names = new Set((keys ?? []).map((k) => basename(k.path).replace(/\.pub$/, '')))
    const values = await formDialog({
      title: t('ssh.generate'),
      message: t('ssh.generateHint'),
      confirmText: t('dlg.create'),
      fields: [
        { key: 'email', label: t('ssh.email'), placeholder: 'you@example.com' },
        {
          key: 'fileName',
          label: t('ssh.fileName'),
          value: names.has('id_ed25519') ? 'id_ed25519_leviathan' : 'id_ed25519'
        },
        { key: 'passphrase', label: t('ssh.passphrase'), type: 'password' }
      ]
    })
    if (!values) return
    try {
      const key = await api.generateSshKey({
        email: values.email.trim(),
        passphrase: values.passphrase,
        fileName: values.fileName.trim()
      })
      await copyText(key.publicKey, t('ssh.created'))
      await load()
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  return (
    <div className="ssh-section">
      <div className="ssh-title-row">
        <span className="ssh-title">
          {t('ssh.title')}
          {keys && keys.length > 0 ? ` (${keys.length})` : ''}
        </span>
        {keys && keys.length > 0 && (
          <button type="button" className="btn small" onClick={() => setShown(!shown)}>
            {shown ? t('ssh.hide') : t('ssh.show')}
          </button>
        )}
      </div>
      {keys && keys.length === 0 && <div className="dim small">{t('ssh.none')}</div>}
      {shown &&
        keys?.map((key) => (
          <div key={key.path} className="ssh-key" title={key.path}>
            <KeyRound size={14} className="dim" />
            <div className="ssh-key-text">
              <span>{basename(key.path)}</span>
              <span className="dim small">
                {key.type} {key.comment}
              </span>
            </div>
            <button
              type="button"
              className="icon-btn small"
              title={t('ssh.copy')}
              onClick={() => void copyText(key.publicKey, t('toast.copied'))}
            >
              <Copy size={14} />
            </button>
          </div>
        ))}
      <div className="ssh-actions">
        <button type="button" className="btn small" onClick={() => void generate()}>
          {t('ssh.generate')}
        </button>
        <a onClick={() => openExternal(GITHUB_SSH_URL)}>{t('ssh.addGithub')}</a>
        <a onClick={() => openExternal(GITLAB_SSH_URL)}>{t('ssh.addGitlab')}</a>
      </div>
    </div>
  )
}
