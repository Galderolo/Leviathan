import { useEffect, useState } from 'react'
import type { GpgKey, SigningSetting, SigningState } from '../../../shared/signing'
import type { SshKey } from '../../../shared/types'
import { chooseSigning } from '../actions'
import { useT, type TKey, type Vars } from '../i18n'
import { useRepo, useStore } from '../store'
import { basename } from '../utils'

const api = window.leviathan

type T = (key: TKey, vars?: Vars) => string

/** The GPG key `user.signingkey` names: by id or fingerprint (its end), with or without `0x` and `!`. */
function gpgKeyFor(key: string, keys: GpgKey[]): GpgKey | undefined {
  const id = key.trim().replace(/^0x/i, '').replace(/!$/, '').toUpperCase()
  if (!id) return undefined
  return keys.find((k) => k.fingerprint.toUpperCase().endsWith(id) || k.id.toUpperCase() === id)
}

/** How a setting reads: not signed, or the key it signs with. */
export function signingLabel(t: T, setting: SigningSetting, gpg: GpgKey[] = []): string {
  if (!setting.sign) return t('signing.no')
  const { format, key } = setting
  if (format === 'ssh') {
    // A key given in the config itself (`key::ssh-ed25519 AAAA…`) has no file name.
    return t('signing.sshKey', { name: key.startsWith('key::') ? `${key.slice(5, 30)}…` : basename(key) || '?' })
  }
  if (format === 'x509') return t('signing.x509Key', { key: key || '?' })
  if (!key) return t('signing.gpgDefault')
  const found = gpgKeyFor(key, gpg)
  return found ? t('signing.gpgKey', { uid: found.uid, id: found.id.slice(-8) }) : t('signing.gpgKeyId', { id: key })
}

const GENERAL = 'general'
const OFF = 'off'

function valueOf(setting: SigningSetting | null): string {
  if (!setting) return GENERAL
  return setting.sign ? `${setting.format}:${setting.key}` : OFF
}

function settingOf(value: string, current: SigningSetting): SigningSetting | null {
  if (value === GENERAL) return null
  if (value === OFF) return { ...current, sign: false }
  const at = value.indexOf(':')
  return { sign: true, format: value.slice(0, at) as SigningSetting['format'], key: value.slice(at + 1) }
}

/** The keys there are to sign with: the SSH public keys in ~/.ssh, and the secret GPG keys. */
function useSigningKeys(repo: string | null): { ssh: SshKey[]; gpg: GpgKey[] } | null {
  const [keys, setKeys] = useState<{ ssh: SshKey[]; gpg: GpgKey[] } | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all([api.listSshKeys().catch(() => []), api.listGpgKeys(repo).catch(() => [])]).then(
      ([ssh, gpg]) => live && setKeys({ ssh, gpg })
    )
    return () => {
      live = false
    }
  }, [repo])
  return keys
}

/** Whether commits are signed, and with which key: a repository's own choice (`repo`), or all repositories'. */
export function SigningChoice({ repo }: { repo: string | null }) {
  const t = useT()
  const keys = useSigningKeys(repo)
  const repoState = useRepo(repo ?? '')?.signing ?? null
  const [globalState, setGlobalState] = useState<SigningState | null>(null)
  useEffect(() => {
    if (repo) return
    let live = true
    void api.getSigning(null).then(
      (s) => live && setGlobalState(s),
      () => {}
    )
    return () => {
      live = false
    }
  }, [repo])
  const state = repo ? repoState : globalState
  if (!state) return null

  const own = repo ? state.local : state.global
  const gpg = keys?.gpg ?? []
  const options: { value: string; label: string }[] = [
    ...(repo
      ? [{ value: GENERAL, label: t('repoSettings.general', { value: signingLabel(t, state.global, gpg) }) }]
      : []),
    { value: OFF, label: t('signing.no') },
    ...(keys?.ssh ?? []).map((k) => ({
      value: `ssh:${k.path}`,
      label: `${t('signing.sshKey', { name: basename(k.path) })}${k.comment ? ` — ${k.comment}` : ''}`
    })),
    ...gpg.map((k) => ({ value: `openpgp:${k.id}`, label: t('signing.gpgKey', { uid: k.uid, id: k.id.slice(-8) }) }))
  ]
  const value = valueOf(own)
  // A key set in git some other way (a path elsewhere, a key id, gpg's default) is kept in the list.
  if (!options.some((o) => o.value === value) && own) options.push({ value, label: signingLabel(t, own, gpg) })

  const save = async (picked: string) => {
    const setting = settingOf(picked, own ?? state.effective)
    if (await chooseSigning(repo, setting)) {
      if (!repo) setGlobalState(await api.getSigning(null).catch(() => null))
    }
  }

  return (
    <>
      <label className="field">
        <span>{repo ? t('signing.thisRepo') : t('signing.allRepos')}</span>
        <select value={value} onChange={(e) => void save(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="dim small">
        {t('signing.hint')}
        {keys && !keys.ssh.length && !keys.gpg.length && (
          <>
            {' '}
            <a onClick={() => useStore.setState({ settingsSection: 'ssh' })}>{t('signing.noKeys')}</a>
          </>
        )}
      </div>
    </>
  )
}
