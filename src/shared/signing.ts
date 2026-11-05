/** How a commit is signed: OpenPGP (gpg), SSH (ssh-keygen) or X.509 (gpgsm), git's `gpg.format`. */
export type SignatureFormat = 'openpgp' | 'ssh' | 'x509'

/**
 * What checking a commit's signature here found:
 * - `good`: valid, by a key trusted here (in the keyring with trust, or among SSH's allowed signers);
 * - `valid`: valid, by a key nothing here vouches for;
 * - `expired`: valid, but the signature or its key has expired;
 * - `revoked`: made by a key revoked since;
 * - `bad`: it does not match the commit (changed after it was signed, or forged);
 * - `unchecked`: it cannot be checked here (the key is missing, or gpg is not installed).
 */
export type SignatureStatus = 'good' | 'valid' | 'expired' | 'revoked' | 'bad' | 'unchecked'

export interface CommitSignature {
  format: SignatureFormat
  status: SignatureStatus
  /** Who signed, as the key says (an OpenPGP user id, an SSH allowed signer); '' when unknown. */
  signer: string
  /** The key's fingerprint, or its id; '' when unknown. */
  key: string
  /** The user's own SSH public key (a file in ~/.ssh) that made it. */
  ownKey?: string
}

/** What a level of git's config says about signing commits. */
export interface SigningSetting {
  /** `commit.gpgsign` */
  sign: boolean
  /** `gpg.format` */
  format: SignatureFormat
  /** `user.signingkey`: an SSH public key's file, or an OpenPGP key id; '' lets gpg pick by the committer's email. */
  key: string
}

export interface SigningState {
  /** What this repository's own config says; null when it says nothing, so the global one applies. */
  local: SigningSetting | null
  /** What the global (or system) config says. */
  global: SigningSetting
  /** What the next commit here does. */
  effective: SigningSetting
}

/** A secret OpenPGP key that can sign. */
export interface GpgKey {
  /** Long key id, what `user.signingkey` takes. */
  id: string
  fingerprint: string
  /** Its first user id, e.g. `Ana <ana@example.com>`. */
  uid: string
}

/** The format of a raw commit's signature (`git cat-file commit`), or null when it is not signed. */
export function signatureFormat(rawCommit: string): SignatureFormat | null {
  const end = rawCommit.indexOf('\n\n')
  const headers = (end < 0 ? rawCommit : rawCommit.slice(0, end)).split('\n')
  const line = headers.find((h) => h.startsWith('gpgsig ') || h.startsWith('gpgsig-sha256 '))
  if (!line) return null
  if (line.includes('BEGIN SSH SIGNATURE')) return 'ssh'
  if (line.includes('BEGIN SIGNED MESSAGE')) return 'x509'
  return 'openpgp'
}

/** git's message when it could not sign a commit: gpg or ssh-keygen failed, or the key could not be read. */
export function signingFailed(message: string): boolean {
  return /gpg failed to sign the data|failed to write commit object|couldn't load public key|load key "|signing failed/i.test(
    message
  )
}

/** git's `%G?` letter as a status. */
export function signatureStatus(code: string): SignatureStatus {
  switch (code.trim()) {
    case 'G':
      return 'good'
    case 'U':
      return 'valid'
    case 'X':
    case 'Y':
      return 'expired'
    case 'R':
      return 'revoked'
    case 'B':
      return 'bad'
    default:
      return 'unchecked'
  }
}

/** git's boolean config values: `true`, `yes`, `on`, a number other than 0, or the key alone. */
export function configBool(value: string | null): boolean {
  if (value === null) return true
  const v = value.trim().toLowerCase()
  if (v === 'true' || v === 'yes' || v === 'on') return true
  return /^-?\d+$/.test(v) && Number(v) !== 0
}

/** The config entries that say whether and how commits are signed: read, written and taken away together. */
export const SIGNING_KEYS = ['commit.gpgsign', 'gpg.format', 'user.signingkey'] as const
type SigningKey = (typeof SIGNING_KEYS)[number]

/** The config entries `signingFromConfig` reads, as `git config --show-scope -z --get-regexp` lists them. */
export const SIGNING_CONFIG_REGEXP = `^(${SIGNING_KEYS.map((key) => key.replace(/\./g, '\\.')).join('|')})$`

function asFormat(value: string | undefined): SignatureFormat {
  return value === 'ssh' || value === 'x509' ? value : 'openpgp'
}

/**
 * Signing as each level of git's config has it, from `git config --show-scope -z --get-regexp` (`scope\0key\nvalue\0`,
 * or `scope\0key\0` for a key alone), entries from the system's up to the command line's.
 */
export function signingFromConfig(out: string): SigningState {
  const tokens = out.split('\0')
  const general: Partial<Record<SigningKey, string>> = {}
  const own: Partial<Record<SigningKey, string>> = {}
  const all: Partial<Record<SigningKey, string>> = {}
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const scope = tokens[i]
    const entry = tokens[i + 1]
    const nl = entry.indexOf('\n')
    const key = (nl < 0 ? entry : entry.slice(0, nl)).toLowerCase() as SigningKey
    if (!SIGNING_KEYS.includes(key)) continue
    const value =
      key === 'commit.gpgsign' ? String(configBool(nl < 0 ? null : entry.slice(nl + 1))) : entry.slice(nl + 1)
    all[key] = value
    if (scope === 'local' || scope === 'worktree') own[key] = value
    else if (scope === 'global' || scope === 'system') general[key] = value
  }
  const setting = (values: Partial<Record<SigningKey, string>>): SigningSetting => ({
    sign: values['commit.gpgsign'] === 'true',
    format: asFormat(values['gpg.format']),
    key: values['user.signingkey'] ?? ''
  })
  const effective = setting(all)
  // The repository's own: it says whether to sign; the format and key it does not set are the general ones.
  const local = own['commit.gpgsign'] === undefined ? null : { ...effective, sign: own['commit.gpgsign'] === 'true' }
  return { local, global: setting(general), effective }
}

/** The secret keys that can sign, from `gpg --list-secret-keys --with-colons`; expired, revoked or offline ones left out. */
export function parseGpgSecretKeys(out: string): GpgKey[] {
  const keys: GpgKey[] = []
  let current: GpgKey | null = null
  for (const line of out.split(/\r?\n/)) {
    const f = line.split(':')
    if (f[0] === 'sec') {
      current = null
      // Validity: e(xpired), r(evoked), d(isabled), i(nvalid). Capabilities: S when the key (or a subkey) signs.
      // `#`: only a stub of the secret key is here (it lives offline).
      if ('erdi'.includes(f[1] || '-') || !(f[11] ?? '').includes('S') || f[14] === '#') continue
      current = { id: f[4], fingerprint: '', uid: '' }
      keys.push(current)
    } else if (current && f[0] === 'fpr' && !current.fingerprint) {
      // The key's own; its subkeys' come after.
      current.fingerprint = f[9] ?? ''
    } else if (current && f[0] === 'uid' && !current.uid && f[1] !== 'r') {
      current.uid = (f[9] ?? '').replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
    }
  }
  return keys
}
