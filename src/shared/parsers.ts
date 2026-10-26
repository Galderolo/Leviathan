import type {
  Commit,
  DiffHunk,
  DiffLine,
  FileChange,
  FileDiff,
  FileStatus,
  GitRef,
  HeadInfo,
  Remote,
  Stash,
  WorkingStatus
} from './types'

const FS = '\x1f' // field separator
const RS = '\x1e' // record separator

/** `git log --format=` string understood by {@link parseLog}. */
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1e'

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  for (const raw of out.split(RS)) {
    const record = raw.replace(/^\r?\n/, '')
    if (!record) continue
    const f = record.split(FS)
    if (f.length < 9) continue
    commits.push({
      hash: f[0],
      parents: f[1] ? f[1].split(' ') : [],
      authorName: f[2],
      authorEmail: f[3],
      authorDate: Number(f[4]),
      committerName: f[5],
      committerEmail: f[6],
      commitDate: Number(f[7]),
      subject: f.slice(8).join(FS)
    })
  }
  return commits
}

/** `git for-each-ref --format=` string understood by {@link parseRefs}. */
export const REF_FORMAT =
  '%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track)%1f%(HEAD)%1f%(symref)%1f%(creatordate:unix)'

/** Parses `for-each-ref` output. Remote names are needed because they may contain slashes. */
export function parseRefs(out: string, remoteNames: string[]): GitRef[] {
  const refs: GitRef[] = []
  // Longest first so `origin/x` wins over `origin` when both exist.
  const remotes = [...remoteNames].sort((a, b) => b.length - a.length)
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [fullName, objectName, peeled, upstream, track, head, symref, created] = line.replace(/\r$/, '').split(FS)
    if (symref) continue // e.g. refs/remotes/origin/HEAD
    const hash = peeled || objectName
    // creatordate: committer date of the tip commit, or the tagger date of an annotated tag
    const date = created ? Number(created) : NaN
    const withDate = (ref: GitRef): GitRef => (Number.isFinite(date) ? { ...ref, date } : ref)
    if (fullName.startsWith('refs/heads/')) {
      const ref: GitRef = { name: fullName.slice(11), fullName, type: 'head', hash, isHead: head === '*' }
      if (upstream) ref.upstream = upstream
      Object.assign(ref, parseTrack(track))
      refs.push(withDate(ref))
    } else if (fullName.startsWith('refs/remotes/')) {
      const name = fullName.slice(13)
      const remote = remotes.find((r) => name.startsWith(r + '/')) ?? name.split('/')[0]
      refs.push(withDate({ name, fullName, type: 'remote', hash, remote }))
    } else if (fullName.startsWith('refs/tags/')) {
      refs.push(withDate({ name: fullName.slice(10), fullName, type: 'tag', hash }))
    }
  }
  return refs
}

/** Parses `[ahead 1, behind 2]` / `[gone]` (requires `LC_ALL=C`). */
export function parseTrack(track: string | undefined): Pick<GitRef, 'ahead' | 'behind' | 'upstreamGone'> {
  const result: Pick<GitRef, 'ahead' | 'behind' | 'upstreamGone'> = {}
  if (!track) return result
  if (track.includes('gone')) result.upstreamGone = true
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  if (ahead) result.ahead = Number(ahead[1])
  if (behind) result.behind = Number(behind[1])
  return result
}

function statusCode(c: string): FileStatus | null {
  switch (c) {
    case 'M':
    case 'T':
      return 'M'
    case 'A':
    case 'D':
    case 'R':
    case 'C':
      return c
    default:
      return null
  }
}

/** Splits `s` on the first `n` spaces; the remainder (which may contain spaces) is the last element. */
function splitN(s: string, n: number): string[] {
  const parts: string[] = []
  let rest = s
  for (let i = 0; i < n; i++) {
    const idx = rest.indexOf(' ')
    if (idx === -1) break
    parts.push(rest.slice(0, idx))
    rest = rest.slice(idx + 1)
  }
  parts.push(rest)
  return parts
}

/** Parses `git status --porcelain=v2 --branch -z --untracked-files=all`. */
export function parseStatus(out: string): { head: HeadInfo; status: WorkingStatus } {
  const head: HeadInfo = { branch: null, hash: null, detached: false, upstream: null, ahead: 0, behind: 0 }
  const status: WorkingStatus = { staged: [], unstaged: [], conflicted: [] }
  const entries = out.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue
    if (e.startsWith('# ')) {
      const [key, ...rest] = e.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') head.hash = value === '(initial)' ? null : value
      else if (key === 'branch.head') {
        if (value === '(detached)') head.detached = true
        else head.branch = value
      } else if (key === 'branch.upstream') head.upstream = value
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(value)
        if (m) {
          head.ahead = Number(m[1])
          head.behind = Number(m[2])
        }
      }
      continue
    }
    const type = e[0]
    if (type === '1' || type === '2') {
      const parts = splitN(e, type === '1' ? 8 : 9)
      const xy = parts[1]
      const path = parts[parts.length - 1]
      const origPath = type === '2' ? entries[++i] : undefined
      const x = statusCode(xy[0])
      const y = statusCode(xy[1])
      if (x) status.staged.push(withOrig({ path, status: x }, x, origPath))
      if (y) status.unstaged.push(withOrig({ path, status: y }, y, origPath))
    } else if (type === 'u') {
      const parts = splitN(e, 10)
      status.conflicted.push({ path: parts[parts.length - 1], status: 'U' })
    } else if (type === '?') {
      status.unstaged.push({ path: e.slice(2), status: '?' })
    }
  }
  return { head, status }
}

function withOrig(change: FileChange, code: FileStatus, origPath: string | undefined): FileChange {
  if (origPath && (code === 'R' || code === 'C')) change.origPath = origPath
  return change
}

/** `git stash list --format=` string understood by {@link parseStashes}. */
export const STASH_FORMAT = '%H%x1f%P%x1f%gd%x1f%gs%x1f%ct'

export function parseStashes(out: string): Stash[] {
  const stashes: Stash[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [hash, parents, ref, message, date] = line.replace(/\r$/, '').split(FS)
    const idx = /\{(\d+)\}/.exec(ref)
    stashes.push({
      index: idx ? Number(idx[1]) : stashes.length,
      ref,
      hash,
      baseHash: parents.split(' ')[0] ?? '',
      message,
      date: Number(date)
    })
  }
  return stashes
}

/** Parses `git remote -v`. */
export function parseRemotes(out: string): Remote[] {
  const map = new Map<string, Remote>()
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(.+) \((fetch|push)\)\r?$/.exec(line)
    if (!m) continue
    const [, name, url, kind] = m
    const remote = map.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
    if (kind === 'fetch') remote.fetchUrl = url
    else remote.pushUrl = url
    map.set(name, remote)
  }
  return [...map.values()]
}

/** Parses `git diff --name-status -z`. */
export function parseNameStatus(out: string): FileChange[] {
  const files: FileChange[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]
    if (!code) continue
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      const origPath = parts[++i]
      const path = parts[++i]
      files.push({ path, origPath, status: letter })
    } else {
      const path = parts[++i]
      const status: FileStatus = letter === 'T' ? 'M' : letter === 'U' ? 'U' : (statusCode(letter) ?? 'M')
      files.push({ path, status })
    }
  }
  return files
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parses a single-file unified diff as produced by `git diff` / `git show`. */
export function parseDiff(out: string, fallbackPath: string): FileDiff {
  const lines = out.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const headerLines: string[] = []
  let i = 0
  while (i < lines.length && !lines[i].startsWith('@@')) {
    headerLines.push(lines[i])
    i++
  }

  let path = fallbackPath
  let oldPath: string | undefined
  let binary = false
  for (const h of headerLines) {
    if (h.startsWith('Binary files ') || h.startsWith('GIT binary patch')) binary = true
    else if (h.startsWith('rename from ')) oldPath = h.slice(12)
    else if (h.startsWith('rename to ')) path = h.slice(10)
    // git appends a tab when the name contains spaces
    else if (h.startsWith('+++ b/')) path = h.slice(6).replace(/\t?\r?$/, '')
  }

  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let patchLines: string[] = []
  let oldNo = 0
  let newNo = 0
  const flush = () => {
    if (current) {
      current.patch = patchLines.join('\n') + '\n'
      hunks.push(current)
    }
  }

  for (; i < lines.length; i++) {
    const raw = lines[i]
    const m = HUNK_RE.exec(raw)
    if (m) {
      flush()
      oldNo = Number(m[1])
      newNo = Number(m[3])
      current = {
        header: raw.replace(/\r$/, ''),
        oldStart: oldNo,
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: newNo,
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
        patch: ''
      }
      patchLines = [raw]
      continue
    }
    if (!current) continue
    patchLines.push(raw)
    const text = raw.slice(1).replace(/\r$/, '')
    let line: DiffLine
    switch (raw[0]) {
      case '+':
        line = { type: 'add', newNo: newNo++, text }
        break
      case '-':
        line = { type: 'del', oldNo: oldNo++, text }
        break
      case '\\':
        line = { type: 'meta', text: raw.replace(/\r$/, '') }
        break
      default:
        line = { type: 'ctx', oldNo: oldNo++, newNo: newNo++, text }
    }
    current.lines.push(line)
  }
  flush()

  const diff: FileDiff = { path, binary, header: headerLines.join('\n') + (headerLines.length ? '\n' : ''), hunks }
  if (oldPath) diff.oldPath = oldPath
  return diff
}

const C_ESCAPES: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' }

/**
 * A path as git prints it in porcelain output: quoted, C style, when it has quotes, backslashes or control
 * characters (the app runs git with core.quotepath=false, so other characters come as they are).
 */
export function unquotePath(path: string): string {
  if (!(path.length > 1 && path.startsWith('"') && path.endsWith('"'))) return path
  return path.slice(1, -1).replace(/\\(.)/g, (whole, c: string) => C_ESCAPES[c] ?? whole)
}

/** Builds an all-additions diff for an untracked file. */
export function untrackedDiff(path: string, content: string): FileDiff {
  return contentDiff(path, content, 'add')
}

/**
 * Shows a whole file as a single hunk: as additions (untracked files) or as
 * context (conflicted files, where the conflict markers are the interesting part).
 */
export function contentDiff(path: string, content: string, type: 'add' | 'ctx'): FileDiff {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  const textLines = content.length ? body.split('\n') : []
  const lines: DiffLine[] = textLines.map((raw, idx) => {
    const text = raw.replace(/\r$/, '')
    return type === 'add' ? { type, newNo: idx + 1, text } : { type, oldNo: idx + 1, newNo: idx + 1, text }
  })
  const header = `@@ -0,0 +1,${textLines.length} @@`
  return {
    path,
    binary: false,
    header: '',
    hunks: textLines.length
      ? [{ header, oldStart: 0, oldLines: 0, newStart: 1, newLines: textLines.length, lines, patch: '' }]
      : []
  }
}
