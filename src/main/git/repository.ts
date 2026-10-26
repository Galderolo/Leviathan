import { existsSync, promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  LOG_FORMAT,
  STASH_FORMAT,
  contentDiff,
  parseDiff,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashes,
  parseStatus,
  unquotePath,
  untrackedDiff
} from '../../shared/parsers'
import { parseCommitTemplate, type CommitDraftText } from '../../shared/commitTemplate'
import { unchangedGaps } from '../../shared/diffGaps'
import { LARGE_FILE_BYTES } from '../../shared/lfs'
import type {
  Commit,
  BlameLine,
  CommitDetails,
  DiffSource,
  FileChange,
  FileCommit,
  FileDiff,
  GitRef,
  Provider,
  PullMode,
  RebaseCommit,
  RepoOperation,
  RepoState,
  ResetMode,
  SubmoduleChange,
  WorkingFile
} from '../../shared/types'
import { BLAME_MAX_LINES, HISTORY_MAX, HISTORY_PAGE } from '../../shared/types'
import { REBASE_ACTIONS, planRebase, rebaseProblem, shQuote, type RebaseItem } from '../../shared/rebase'
import type { BranchConfig, HeadState, RefMove, RepoChange, Snapshot } from '../../shared/undo'
import { listRefs } from './refs'
import { GitError, NON_INTERACTIVE_ENV, git, holdingIndex } from './runner'
import { lfsFilesAmong, plainLfs, stagedBlobs } from './staged'

export type ProgressFn = (line: string) => void

const MAX_FILE_PREVIEW = 2 * 1024 * 1024

async function run(repo: string, args: string[], extra: Partial<Parameters<typeof git>[1]> = {}): Promise<string> {
  const { stdout } = await git(args, { cwd: repo, ...extra })
  return stdout
}

/**
 * File names are data, not patterns (`[id].tsx` must not match `i.tsx`). Only applied to
 * commands that receive user paths: git's own porcelain (e.g. `stash -u`) relies on magic
 * pathspecs internally and breaks if this is set globally.
 */
const LITERAL_PATHS = { GIT_LITERAL_PATHSPECS: '1' }

/** Feeds paths through stdin so long selections never hit command-line length limits. */
function pathspecInput(paths: string[]) {
  return {
    args: ['--pathspec-from-file=-', '--pathspec-file-nul'],
    opts: { input: paths.join('\0'), env: LITERAL_PATHS }
  }
}

function assertSafeArg(value: string, what: string): void {
  if (!value || value.startsWith('-')) throw new Error(`Invalid ${what}: "${value}"`)
}

async function assertBranchName(repo: string, name: string): Promise<void> {
  assertSafeArg(name, 'branch name')
  try {
    await run(repo, ['check-ref-format', '--branch', name])
  } catch {
    throw new Error(`"${name}" is not a valid branch name`)
  }
}

// ---------------------------------------------------------------------------
// Repository lifecycle

export async function gitVersion(): Promise<string> {
  const { stdout } = await git(['--version'], { cwd: process.cwd() })
  return stdout.trim()
}

export async function openRepo(path: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`Folder does not exist: ${path}`)
  try {
    const top = (await run(path, ['rev-parse', '--show-toplevel'])).trim()
    return resolve(top)
  } catch (err) {
    if (err instanceof GitError) throw new Error(`Not a git repository: ${path}`)
    throw err
  }
}

export async function initRepo(path: string, branch: string): Promise<string> {
  assertSafeArg(branch, 'branch name')
  await fs.mkdir(path, { recursive: true })
  await run(path, ['init', '-q', `--initial-branch=${branch}`])
  return openRepo(path)
}

/** `extraArgs` (e.g. account credentials as `-c` options) go before the `clone` subcommand. */
export async function cloneRepo(
  url: string,
  dest: string,
  onProgress: ProgressFn,
  extraArgs: string[] = []
): Promise<string> {
  assertSafeArg(url.trim(), 'URL')
  if (!isAbsolute(dest)) throw new Error('Destination must be an absolute path')
  if (existsSync(dest) && (await fs.readdir(dest)).length > 0) {
    throw new Error(`Destination folder is not empty: ${dest}`)
  }
  const parent = dirname(dest)
  await fs.mkdir(parent, { recursive: true })
  await git([...extraArgs, 'clone', '--progress', '--', url.trim(), dest], { cwd: parent, onProgress })
  return openRepo(dest)
}

// ---------------------------------------------------------------------------
// Reading

const gitDirs = new Map<string, string>()

async function gitDir(repo: string): Promise<string> {
  let dir = gitDirs.get(repo)
  if (!dir) {
    dir = (await run(repo, ['rev-parse', '--absolute-git-dir'])).trim()
    gitDirs.set(repo, dir)
  }
  return dir
}

async function currentOperation(repo: string): Promise<RepoOperation> {
  const dir = await gitDir(repo)
  if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) return 'rebase'
  if (existsSync(join(dir, 'MERGE_HEAD'))) return 'merge'
  if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (existsSync(join(dir, 'REVERT_HEAD'))) return 'revert'
  return null
}

/** The commit an interactive rebase stopped at to be edited: git leaves `rebase-merge/amend` then (not for a conflict). */
async function editingCommit(repo: string, operation: RepoOperation): Promise<string | null> {
  if (operation !== 'rebase') return null
  const text = await fs.readFile(join(await gitDir(repo), 'rebase-merge', 'amend'), 'utf8').catch(() => '')
  return text.trim() || null
}

const SLOW_STATUS_MS = 500
const INDEX_REFRESH_EVERY_MS = 5 * 60_000
const lastIndexRefresh = new Map<string, number>()

/**
 * A slow status usually means stale stat info in the index (files touched, copied or checked out by other tools
 * without changing): git reads them all again on every status, LFS files through git-lfs. Statuses here never
 * write the index (`GIT_OPTIONAL_LOCKS=0`), so it is refreshed now and then on purpose.
 */
export function shouldRefreshIndex(now: number, last: number | undefined, statusMs: number): boolean {
  return statusMs >= SLOW_STATUS_MS && (last === undefined || now - last >= INDEX_REFRESH_EVERY_MS)
}

/** Stores fresh stat info in the index, as `git status` in a terminal does; contents never change. Skipped when another git holds the index. */
export async function refreshIndexStat(repo: string): Promise<void> {
  try {
    // The app's own commands in this repository wait for it rather than finding the index locked.
    await holdingIndex(repo, () =>
      git(['update-index', '-q', '--refresh'], { cwd: repo, okCodes: [0, 1], noLockWait: true })
    )
  } catch {
    // another git holds the index: next time
  }
}

async function maybeRefreshIndex(repo: string, statusMs: number): Promise<void> {
  const key = process.platform === 'win32' ? resolve(repo).toLowerCase() : resolve(repo)
  const now = Date.now()
  if (!shouldRefreshIndex(now, lastIndexRefresh.get(key), statusMs)) return
  lastIndexRefresh.set(key, now)
  await refreshIndexStat(repo)
}

export async function getState(repo: string): Promise<RepoState> {
  const statusStart = Date.now()
  let statusMs = 0
  const [statusOut, remotesOut, refsOut, stashOut, operation] = await Promise.all([
    run(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']).then((out) => {
      statusMs = Date.now() - statusStart
      return out
    }),
    run(repo, ['remote', '-v']),
    listRefs(repo),
    run(repo, ['stash', 'list', `--format=${STASH_FORMAT}`]),
    currentOperation(repo)
  ])
  const remotes = parseRemotes(remotesOut)
  const { head, status } = parseStatus(statusOut)
  const refs = parseRefs(
    refsOut,
    remotes.map((r) => r.name)
  )
  const changed = [...new Set([...status.staged, ...status.unstaged, ...status.conflicted].map((f) => f.path))]
  const [unpushed, lfsFiles, blobs] = await Promise.all([
    unpushedCommits(repo, head, refs, remotes.length > 0),
    lfsFilesAmong(repo, changed),
    status.staged.some((f) => f.status !== 'D') ? stagedBlobs(repo) : Promise.resolve([])
  ])
  const lfs = new Set(lfsFiles)
  const size = ({ path, size }: { path: string; size: number }) => ({ path, size })
  const editing = await editingCommit(repo, operation)
  await maybeRefreshIndex(repo, statusMs)
  return {
    path: repo,
    head,
    refs,
    stashes: parseStashes(stashOut),
    remotes,
    status,
    operation,
    editing,
    unpushed,
    lfsFiles,
    // Files that go through LFS are staged as small pointers: big ones are only those outside LFS.
    largeFiles: blobs.filter((b) => !lfs.has(b.path) && b.size > LARGE_FILE_BYTES).map(size),
    unconvertedLfs: plainLfs(blobs, lfsFiles).map(size)
  }
}

/**
 * Commits of the checked-out branch that a push would send, newest first (at
 * most 500): those not on its upstream, or on no remote when the branch has no
 * upstream on a remote (none, deleted, or a local branch).
 */
async function unpushedCommits(
  repo: string,
  head: RepoState['head'],
  refs: GitRef[],
  hasRemotes: boolean
): Promise<string[]> {
  if (!head.branch || !head.hash || !hasRemotes) return []
  const onRemote = refs.some((r) => r.type === 'remote' && r.name === head.upstream)
  let range = ['HEAD', '--not', '--remotes']
  if (head.upstream && onRemote) {
    // Runs on every refresh: when status already says nothing is ahead, skip the walk.
    if (!head.ahead) return []
    range = ['@{upstream}..HEAD']
  }
  const out = await git(['rev-list', '--max-count=500', ...range, '--'], { cwd: repo, okCodes: [0, 128] })
  return out.exitCode === 0 ? out.stdout.split('\n').filter(Boolean) : []
}

/** Which branches the graph shows: all but `hidden`, or only `solo` (full ref names). */
export interface LogScope {
  hidden?: string[]
  solo?: string | null
}

export async function getLog(
  repo: string,
  limit: number,
  scope: LogScope = {}
): Promise<{ commits: Commit[]; hasMore: boolean }> {
  const isRef = (r: unknown): r is string => typeof r === 'string' && r.startsWith('refs/') && !/\s/.test(r)
  const hidden = new Set((scope.hidden ?? []).filter(isRef))
  const solo = isRef(scope.solo) && (await refValue(repo, scope.solo)) ? scope.solo : null
  let revs: string[]
  let input: string | undefined
  if (solo) {
    revs = [solo]
  } else if (hidden.size) {
    // Every ref but the hidden ones, through stdin: there can be thousands.
    const all = (await run(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']))
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r && !hidden.has(r))
    const head = await currentHead(repo)
    if (head.hash && !(head.branch && hidden.has(`refs/heads/${head.branch}`))) all.push('HEAD')
    if (!all.length) return { commits: [], hasMore: false }
    revs = ['--stdin']
    input = all.join('\n') + '\n'
  } else {
    // Decide what to log up front instead of parsing (localised) error messages:
    // HEAD may be unborn (new repo, orphan branch) while other branches exist.
    revs = ['--branches', '--remotes', '--tags']
    if (await hasHead(repo)) revs.push('HEAD')
    else {
      const anyRef = await run(repo, [
        'for-each-ref',
        '--count=1',
        '--format=%(refname)',
        'refs/heads',
        'refs/remotes',
        'refs/tags'
      ])
      if (!anyRef.trim()) return { commits: [], hasMore: false }
    }
  }
  const out = await run(
    repo,
    ['log', '--date-order', `--max-count=${limit + 1}`, `--format=${LOG_FORMAT}`, ...revs, '--'],
    {
      input
    }
  )
  const commits = parseLog(out)
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit }
}

export async function getCommitDetails(repo: string, hash: string): Promise<CommitDetails> {
  assertSafeArg(hash, 'commit')
  const [meta, message] = await Promise.all([
    run(repo, ['show', '-s', `--format=${LOG_FORMAT}`, hash, '--']),
    run(repo, ['show', '-s', '--format=%B', hash, '--'])
  ])
  const [commit] = parseLog(meta)
  if (!commit) throw new Error(`Commit not found: ${hash}`)
  const filesOut = commit.parents.length
    ? await run(repo, ['diff', '--name-status', '-z', '-M', commit.parents[0], hash, '--'])
    : await run(repo, ['diff-tree', '--no-commit-id', '-r', '--name-status', '-z', '--root', '-M', hash, '--'])
  const files = parseNameStatus(filesOut)
  // A stash keeps its untracked files in a third parent, a commit of their own.
  if (commit.parents.length === 3 && (await isStash(repo, hash))) {
    const untracked = await run(repo, ['ls-tree', '-r', '-z', '--name-only', commit.parents[2], '--'])
    for (const path of untracked.split('\0').filter(Boolean)) files.push({ path, status: '?' })
  }
  return { commit, message: message.trimEnd(), files }
}

async function isStash(repo: string, hash: string): Promise<boolean> {
  const { stdout } = await git(['log', '-g', '--format=%H', 'refs/stash', '--'], { cwd: repo, okCodes: [0, 128] })
  return stdout.split('\n').includes(hash)
}

/** Resolves `file` inside `repo`, refusing paths that escape it. */
export function insideRepo(repo: string, file: string): string {
  const full = resolve(repo, file)
  const rel = relative(repo, full)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path is outside the repository: ${file}`)
  return full
}

async function readPreview(repo: string, path: string): Promise<{ binary: boolean; content: string }> {
  const full = insideRepo(repo, path)
  // lstat: never follow a symlink, its target may live outside the repository.
  const stat = await fs.lstat(full)
  if (stat.isDirectory() || stat.isSymbolicLink()) return { binary: true, content: '' }
  const handle = await fs.open(full, 'r')
  try {
    const size = Math.min(stat.size, MAX_FILE_PREVIEW)
    const buffer = Buffer.alloc(size)
    await handle.read(buffer, 0, size, 0)
    const binary = buffer.subarray(0, 8000).includes(0)
    return { binary, content: binary ? '' : buffer.toString('utf8') }
  } finally {
    await handle.close()
  }
}

/** The commits between two commits of a submodule, each way (at most 100 each), when they are available here. */
async function submoduleChange(repo: string, diff: FileDiff): Promise<FileDiff> {
  if (!/^(index \S+ 160000|new file mode 160000|deleted file mode 160000)$/m.test(diff.header)) return diff
  const lines = diff.hunks.flatMap((h) => h.lines)
  const commitOf = (type: 'add' | 'del') =>
    /Subproject commit ([0-9a-f]{7,})/.exec(lines.find((l) => l.type === type)?.text ?? '')?.[1] ?? null
  const from = commitOf('del')
  const to = commitOf('add')
  const change: SubmoduleChange = { from, to, commits: [], missing: false }
  const dir = insideRepo(repo, diff.path)
  if (!existsSync(join(dir, '.git'))) return { ...diff, submodule: { ...change, missing: true } }
  if (!from || !to || from === to) return { ...diff, submodule: change }
  const list = async (range: string, added: boolean) =>
    (await run(dir, ['log', '--max-count=100', '--format=%H%x1f%s', range, '--']))
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, subject] = line.split('\x1f')
        return { hash, subject: subject ?? '', added }
      })
  try {
    const [added, removed] = await Promise.all([list(`${from}..${to}`, true), list(`${to}..${from}`, false)])
    return { ...diff, submodule: { ...change, commits: [...added, ...removed] } }
  } catch {
    // The submodule does not have one of those commits (not fetched there yet).
    return { ...diff, submodule: { ...change, missing: true } }
  }
}

/**
 * Context that takes in any file as one hunk. git doubles it when joining hunks: near INT_MAX it overflows and
 * splits the file into overlapping hunks.
 */
const WHOLE_FILE = '-U100000000'

/** `fullFile`: also the file's unchanged lines around the hunks (`gaps`), for reading a change in its file. */
export async function getDiff(repo: string, source: DiffSource, fullFile = false): Promise<FileDiff> {
  const [diff, whole] = await Promise.all([
    getFileDiff(repo, source),
    fullFile ? getFileDiff(repo, source, [WHOLE_FILE]) : null
  ])
  const withGaps = whole && !diff.binary ? { ...diff, gaps: unchangedGaps(diff.hunks, whole.hunks) } : diff
  return submoduleChange(repo, withGaps)
}

async function getFileDiff(repo: string, source: DiffSource, extraArgs: string[] = []): Promise<FileDiff> {
  // A submodule's change as its two commits, whatever diff.submodule the user configured.
  const diffArgs = ['--no-ext-diff', '-M', '--submodule=short', ...extraArgs]
  switch (source.kind) {
    case 'unstaged': {
      if (source.untracked || source.conflicted) {
        const { binary, content } = await readPreview(repo, source.path)
        if (binary) return { path: source.path, binary: true, header: '', hunks: [] }
        return source.untracked ? untrackedDiff(source.path, content) : contentDiff(source.path, content, 'ctx')
      }
      const out = await run(repo, ['diff', ...diffArgs, '--', source.path], { env: LITERAL_PATHS })
      return parseDiff(out, source.path)
    }
    case 'staged': {
      const out = await run(repo, ['diff', '--cached', ...diffArgs, '--', source.path], { env: LITERAL_PATHS })
      return parseDiff(out, source.path)
    }
    case 'commit': {
      assertSafeArg(source.hash, 'commit')
      const paths = source.oldPath ? [source.oldPath, source.path] : [source.path]
      // A stash's untracked files are a commit of their own, with no parent: every file shows as added.
      const out = source.untracked
        ? await run(repo, ['show', '--format=', ...diffArgs, `${source.hash}^3`, '--', source.path], {
            env: LITERAL_PATHS
          })
        : source.parent
          ? await run(repo, ['diff', ...diffArgs, source.parent, source.hash, '--', ...paths], { env: LITERAL_PATHS })
          : await run(repo, ['show', '--format=', ...diffArgs, source.hash, '--', ...paths], { env: LITERAL_PATHS })
      return parseDiff(out, source.path)
    }
  }
}

// ---------------------------------------------------------------------------
// Working tree

async function hasHead(repo: string): Promise<boolean> {
  const { exitCode } = await git(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: repo, okCodes: [0, 1] })
  return exitCode === 0
}

export async function stage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  const ps = pathspecInput(paths)
  await run(repo, ['add', '-A', ...ps.args], ps.opts)
}

export async function stageAll(repo: string): Promise<void> {
  await run(repo, ['add', '-A'])
}

export async function unstage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  const ps = pathspecInput(paths)
  if (await hasHead(repo)) await run(repo, ['restore', '--staged', ...ps.args], ps.opts)
  else await run(repo, ['rm', '--cached', '-r', '-q', ...ps.args], ps.opts)
}

export async function unstageAll(repo: string): Promise<void> {
  if (await hasHead(repo)) await run(repo, ['reset', '-q'])
  else await run(repo, ['rm', '--cached', '-r', '-q', '.'])
}

export async function discard(repo: string, paths: string[], untracked: string[]): Promise<void> {
  if (paths.length) {
    const ps = pathspecInput(paths)
    await run(repo, ['restore', '--worktree', ...ps.args], ps.opts)
  }
  for (const file of untracked) {
    await fs.rm(insideRepo(repo, file), { recursive: true, force: true })
  }
}

export async function discardAll(repo: string): Promise<void> {
  if (await hasHead(repo)) await run(repo, ['reset', '--hard', '-q'])
  await run(repo, ['clean', '-fdq'])
}

export async function applyPatch(
  repo: string,
  patch: string,
  opts: { cached: boolean; reverse: boolean }
): Promise<void> {
  const args = ['apply', '--whitespace=nowarn']
  if (opts.cached) args.push('--cached')
  if (opts.reverse) args.push('--reverse')
  args.push('-')
  await run(repo, args, { input: patch })
}

export async function commit(repo: string, message: string, amend: boolean): Promise<void> {
  const args = ['commit', '-q']
  if (amend) args.push('--amend')
  if (amend && !message.trim()) args.push('--no-edit')
  else {
    if (!message.trim()) throw new Error('Commit message is empty')
    args.push('-F', '-')
  }
  await run(repo, args, { input: message })
}

export async function headMessage(repo: string): Promise<string> {
  if (!(await hasHead(repo))) return ''
  return (await run(repo, ['log', '-1', '--format=%B'])).trimEnd()
}

/** Larger than any commit message template; a bigger file is not one. */
const TEMPLATE_MAX_BYTES = 64 * 1024

/** The message git's commit.template starts commits with (a path from the repository's folder, ~ expanded). */
export async function getCommitTemplate(repo: string): Promise<CommitDraftText | null> {
  const { stdout, exitCode } = await git(['config', '--path', '--get', 'commit.template'], {
    cwd: repo,
    okCodes: [0, 1]
  })
  const file = exitCode === 0 ? stdout.trim() : ''
  if (!file) return null
  try {
    const full = resolve(repo, file)
    if ((await fs.stat(full)).size > TEMPLATE_MAX_BYTES) return null
    return parseCommitTemplate(await fs.readFile(full, 'utf8'))
  } catch {
    return null
  }
}

export async function ignore(repo: string, pattern: string): Promise<void> {
  const file = join(repo, '.gitignore')
  let current = ''
  try {
    current = await fs.readFile(file, 'utf8')
  } catch {
    // no .gitignore yet
  }
  const prefix = current && !current.endsWith('\n') ? '\n' : ''
  await fs.writeFile(file, `${current}${prefix}${pattern}\n`, 'utf8')
}

// ---------------------------------------------------------------------------
// Branches and history

export async function checkout(repo: string, ref: string): Promise<void> {
  assertSafeArg(ref, 'ref')
  await run(repo, ['checkout', '-q', ref, '--'])
}

export async function checkoutRemote(repo: string, remoteBranch: string): Promise<void> {
  assertSafeArg(remoteBranch, 'branch')
  const remotes = parseRemotes(await run(repo, ['remote', '-v']))
    .map((r) => r.name)
    .sort((a, b) => b.length - a.length)
  const remote = remotes.find((r) => remoteBranch.startsWith(r + '/'))
  const local = remote ? remoteBranch.slice(remote.length + 1) : remoteBranch
  const { exitCode } = await git(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], {
    cwd: repo,
    okCodes: [0, 1]
  })
  if (exitCode === 0) await run(repo, ['checkout', '-q', local, '--'])
  else await run(repo, ['checkout', '-q', '-b', local, '--track', remoteBranch])
}

export async function checkoutDetached(repo: string, hash: string): Promise<void> {
  assertSafeArg(hash, 'commit')
  await run(repo, ['checkout', '-q', '--detach', hash])
}

export async function createBranch(
  repo: string,
  name: string,
  startPoint: string | null,
  doCheckout: boolean
): Promise<void> {
  await assertBranchName(repo, name)
  if (startPoint) assertSafeArg(startPoint, 'start point')
  const tail = startPoint ? [startPoint] : []
  if (doCheckout) await run(repo, ['checkout', '-q', '-b', name, ...tail])
  else await run(repo, ['branch', name, ...tail])
}

export async function renameBranch(repo: string, oldName: string, newName: string): Promise<void> {
  assertSafeArg(oldName, 'branch name')
  await assertBranchName(repo, newName)
  await run(repo, ['branch', '-m', oldName, newName])
}

export async function deleteBranch(repo: string, name: string, force: boolean): Promise<void> {
  assertSafeArg(name, 'branch name')
  // The UI recognises "not fully merged" to offer a forced delete, so keep the message in English.
  await run(repo, ['branch', force ? '-D' : '-d', name], { env: { LC_ALL: 'C', LANGUAGE: 'C' } })
}

export async function deleteRemoteBranch(
  repo: string,
  remote: string,
  branch: string,
  onProgress: ProgressFn
): Promise<void> {
  assertSafeArg(remote, 'remote')
  assertSafeArg(branch, 'branch name')
  await git(['push', '--progress', remote, '--delete', branch], { cwd: repo, onProgress })
}

export async function merge(repo: string, ref: string): Promise<void> {
  assertSafeArg(ref, 'ref')
  await run(repo, ['merge', '--no-edit', ref])
}

export async function rebase(repo: string, onto: string): Promise<void> {
  assertSafeArg(onto, 'ref')
  await run(repo, ['rebase', onto])
}

/** The commits an interactive rebase onto `base` would rewrite (`base..HEAD`), oldest first. */
export async function getRebaseCommits(repo: string, base: string): Promise<RebaseCommit[]> {
  assertSafeArg(base, 'commit')
  const ancestor = await git(['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: repo, okCodes: [0, 1] })
  if (ancestor.exitCode !== 0) throw new Error('That commit is not part of the current branch.')
  if ((await run(repo, ['rev-list', '--merges', `${base}..HEAD`])).trim()) {
    throw new Error('These commits include merges, which interactive rebase does not support.')
  }
  const out = await run(repo, ['log', '--reverse', '-z', '--format=%H%x1f%an%x1f%at%x1f%B', `${base}..HEAD`])
  const commits = out
    .split('\0')
    .filter((entry) => entry.trim())
    .map((entry) => {
      const [hash, author, date, body = ''] = entry.replace(/^\n/, '').split('\x1f')
      const message = body.trimEnd()
      return { hash, author, date: Number(date), message, subject: message.split('\n')[0] }
    })
  if (!commits.length) throw new Error('There are no commits after that one.')
  return commits
}

/**
 * Rewrites `base..HEAD` as `items` says. No editor is opened: git copies a todo
 * list written beforehand, and rewords read their message from a file. Stops,
 * like any rebase, when a commit does not apply cleanly.
 */
export async function interactiveRebase(repo: string, base: string, items: RebaseItem[]): Promise<void> {
  const operation = await currentOperation(repo)
  if (operation) throw new Error(`A ${operation} is in progress. Finish or abort it first.`)
  if ((await run(repo, ['status', '--porcelain', '--untracked-files=no'])).trim()) {
    throw new Error('Commit or stash your uncommitted changes before rebasing.')
  }
  if (items.some((i) => !REBASE_ACTIONS.includes(i.action))) throw new Error('Unknown rebase action')
  const problem = rebaseProblem(items)
  if (problem) throw new Error(`This rebase cannot run (${problem}).`)
  // The list was read earlier: it must still be exactly the commits to rewrite.
  const commits = await getRebaseCommits(repo, base)
  if (
    commits
      .map((c) => c.hash)
      .sort()
      .join() !==
    items
      .map((i) => i.hash)
      .sort()
      .join()
  ) {
    throw new Error('The branch changed since the list was read. Open it again.')
  }

  // Inside the git directory, so the files outlive a stop for a conflict.
  const dir = join(await gitDir(repo), 'leviathan-rebase')
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  const file = (name: string) => join(dir, name).replace(/\\/g, '/')
  const messages = new Map(commits.map((c) => [c.hash, c.message]))
  const plan = planRebase(items, (hash) => messages.get(hash) ?? '', file)
  for (const [name, text] of Object.entries(plan.files)) await fs.writeFile(file(name), text, 'utf8')
  await fs.writeFile(file('todo'), plan.todo, 'utf8')
  // A failed step (a reword's amend, say) runs again on continue instead of being skipped.
  await run(repo, ['rebase', '-i', '--reschedule-failed-exec', base], {
    env: { GIT_SEQUENCE_EDITOR: `cp ${shQuote(file('todo'))}` }
  })
  await removeRebaseFiles(repo)
}

/** The todo list and messages of an interactive rebase, once no rebase needs them any more. */
async function removeRebaseFiles(repo: string): Promise<void> {
  if ((await currentOperation(repo)) === 'rebase') return
  // Best effort: an antivirus holding one of the files for a moment must not turn success into an error.
  await fs
    .rm(join(await gitDir(repo), 'leviathan-rebase'), { recursive: true, force: true, maxRetries: 3 })
    .catch(() => {})
}

export async function cherryPick(repo: string, hash: string): Promise<void> {
  assertSafeArg(hash, 'commit')
  await run(repo, ['cherry-pick', hash])
}

export async function revert(repo: string, hash: string): Promise<void> {
  assertSafeArg(hash, 'commit')
  await run(repo, ['revert', '--no-edit', hash])
}

export async function reset(repo: string, hash: string, mode: ResetMode): Promise<void> {
  assertSafeArg(hash, 'commit')
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw new Error(`Invalid reset mode: ${mode}`)
  await run(repo, ['reset', `--${mode}`, '-q', hash])
}

export async function abortOperation(repo: string): Promise<void> {
  const op = await currentOperation(repo)
  if (!op) return
  await run(repo, [op, '--abort'])
  await removeRebaseFiles(repo)
}

export async function continueOperation(repo: string): Promise<void> {
  const op = await currentOperation(repo)
  if (op === 'merge') await run(repo, ['commit', '--no-edit'])
  else if (op) await run(repo, [op, '--continue'])
  await removeRebaseFiles(repo)
}

export async function createTag(repo: string, name: string, hash: string, message: string | null): Promise<void> {
  assertSafeArg(name, 'tag name')
  assertSafeArg(hash, 'commit')
  try {
    await run(repo, ['check-ref-format', `refs/tags/${name}`])
  } catch {
    throw new Error(`"${name}" is not a valid tag name`)
  }
  if (message && message.trim()) await run(repo, ['tag', '-a', name, hash, '-F', '-'], { input: message })
  else await run(repo, ['tag', name, hash])
}

export async function deleteTag(repo: string, name: string): Promise<void> {
  assertSafeArg(name, 'tag name')
  await run(repo, ['tag', '-d', name])
}

// ---------------------------------------------------------------------------
// Stash

/** Stashes every change (new files too), or only those of `paths`. */
export async function stashSave(repo: string, message: string | null, paths?: string[]): Promise<void> {
  const args = ['stash', 'push', '--include-untracked']
  if (message && message.trim()) args.push('-m', message.trim())
  if (!paths?.length) {
    await run(repo, args)
    return
  }
  for (const path of paths) insideRepo(repo, path)
  await run(repo, [...args, '--', ...paths], { env: LITERAL_PATHS })
}

function stashRef(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid stash index: ${index}`)
  return `stash@{${index}}`
}

/**
 * Resolves `stash@{index}` and checks it is still the stash the user picked:
 * indexes shift whenever a stash is pushed or dropped elsewhere.
 */
async function verifiedStashRef(repo: string, index: number, hash: string): Promise<string> {
  const ref = stashRef(index)
  const { stdout, exitCode } = await git(['rev-parse', '-q', '--verify', ref], { cwd: repo, okCodes: [0, 1] })
  if (exitCode !== 0 || stdout.trim() !== hash) {
    throw new Error('The stash list changed. Refresh and try again.')
  }
  return ref
}

export async function stashPop(repo: string, index: number, hash: string): Promise<void> {
  await run(repo, ['stash', 'pop', '-q', await verifiedStashRef(repo, index, hash)])
}

export async function stashApply(repo: string, index: number, hash: string): Promise<void> {
  await run(repo, ['stash', 'apply', '-q', await verifiedStashRef(repo, index, hash)])
}

/**
 * Untracked files saved in a stash that already exist in the working tree.
 * Applying the stash leaves them as they are (git never overwrites a file),
 * applies the rest, fails, and keeps the stash.
 */
export async function stashUntrackedClashes(repo: string, index: number, hash: string): Promise<string[]> {
  const ref = await verifiedStashRef(repo, index, hash)
  // No third parent (a stash without untracked files): nothing to restore, nothing to clash.
  const { stdout, exitCode } = await git(['ls-tree', '-r', '-z', '--name-only', `${ref}^3`, '--'], {
    cwd: repo,
    okCodes: [0, 128]
  })
  if (exitCode !== 0) return []
  const files = stdout.split('\0').filter(Boolean)
  const exists = await Promise.all(
    files.map((file) =>
      fs.lstat(insideRepo(repo, file)).then(
        () => true,
        () => false
      )
    )
  )
  return files.filter((_, i) => exists[i])
}

/**
 * Files the stash changes that also have uncommitted changes (staged or not): git refuses to apply the stash
 * while they are there, so as not to overwrite them.
 */
export async function stashTrackedClashes(repo: string, index: number, hash: string): Promise<string[]> {
  const ref = await verifiedStashRef(repo, index, hash)
  const stashed = (await run(repo, ['diff', '--name-only', '-z', `${ref}^1`, ref, '--'])).split('\0').filter(Boolean)
  if (!stashed.length) return []
  const status = await run(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=no'])
  const dirty = new Set<string>()
  const entries = status.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    dirty.add(entry.slice(3))
    // A rename or copy is followed by its old path.
    if (entry[0] === 'R' || entry[0] === 'C') dirty.add(entries[++i])
  }
  return stashed.filter((file) => dirty.has(file))
}

export async function stashDrop(repo: string, index: number, hash: string): Promise<void> {
  await run(repo, ['stash', 'drop', '-q', await verifiedStashRef(repo, index, hash)])
}

// ---------------------------------------------------------------------------
// Remotes

/** `background`: never prompt for credentials (auto-fetch); fail instead. */
export async function fetchAll(repo: string, onProgress: ProgressFn, background = false): Promise<void> {
  await git(['fetch', '--all', '--prune', '--progress'], {
    cwd: repo,
    onProgress,
    env: background ? NON_INTERACTIVE_ENV : undefined
  })
}

export async function pull(repo: string, mode: PullMode, onProgress: ProgressFn): Promise<void> {
  const modeArgs = mode === 'rebase' ? ['--rebase'] : mode === 'ff-only' ? ['--ff-only'] : ['--no-rebase', '--ff']
  await git(['pull', '--progress', ...modeArgs], { cwd: repo, onProgress })
}

async function configValue(repo: string, key: string): Promise<string | null> {
  const { stdout, exitCode } = await git(['config', '--get', key], { cwd: repo, okCodes: [0, 1] })
  return exitCode === 0 ? stdout.trim() : null
}

async function isAncestor(repo: string, ancestor: string, of: string): Promise<boolean> {
  const { exitCode } = await git(['merge-base', '--is-ancestor', ancestor, of], { cwd: repo, okCodes: [0, 1] })
  return exitCode === 0
}

/** Points a branch at `to`; when it is checked out, with `reset --keep`, which never drops local changes. */
async function moveBranch(repo: string, branch: string, from: string, to: string): Promise<void> {
  if (from === to) return
  if ((await currentHead(repo)).branch === branch) await run(repo, ['reset', '-q', '--keep', to])
  else await run(repo, ['update-ref', `refs/heads/${branch}`, to, from])
}

/**
 * Checks out a pull request. A pull request whose branch lives in this
 * repository is checked out as that branch, tracking the remote one (and
 * fast-forwarded to it) — unless a local branch of that name is something else.
 * Otherwise (forks) the provider's `pull/N/head` (GitLab: `merge-requests/N/head`)
 * becomes a local `pr/N` branch. Checking out again brings it up to date, also
 * after the author rewrote it, but never drops commits made on the local branch.
 */
export async function checkoutPullRequest(
  repo: string,
  remote: string,
  pr: { number: number; sourceBranch: string; fromFork: boolean },
  provider: Provider
): Promise<void> {
  assertSafeArg(remote, 'remote')
  if (!Number.isInteger(pr.number) || pr.number <= 0) throw new Error(`Invalid pull request number: ${pr.number}`)
  if (!pr.fromFork) {
    const branch = pr.sourceBranch
    assertSafeArg(branch, 'branch')
    const tracking = `refs/remotes/${remote}/${branch}`
    // `+` like git's default refspec: the remote-tracking branch follows force pushes.
    await git(['fetch', remote, `+refs/heads/${branch}:${tracking}`], { cwd: repo })
    const local = await refValue(repo, `refs/heads/${branch}`)
    if (!local) {
      await run(repo, ['checkout', '-q', '--track', `${remote}/${branch}`])
      return
    }
    const follows =
      (await configValue(repo, `branch.${branch}.remote`)) === remote &&
      (await configValue(repo, `branch.${branch}.merge`)) === `refs/heads/${branch}`
    if (follows) {
      const target = (await refValue(repo, tracking))!
      if (await isAncestor(repo, local, target)) await moveBranch(repo, branch, local, target)
      await run(repo, ['checkout', '-q', branch, '--'])
      return
    }
    // A local branch with that name holds other work: leave it alone and use pr/N.
  }

  const branch = `pr/${pr.number}`
  const source = pullRequestSource(pr, provider)
  // The last version fetched, out of sight of the branch lists, tells whether pr/N has commits of its own.
  const mirror = `refs/leviathan/pulls/${pr.number}`
  const previous = await refValue(repo, mirror)
  await git(['fetch', remote, `+${source}:${mirror}`], { cwd: repo })
  const target = (await refValue(repo, mirror))!
  const local = await refValue(repo, `refs/heads/${branch}`)
  if (!local) await run(repo, ['branch', '-q', branch, target])
  else if (local === previous || (await isAncestor(repo, local, target))) await moveBranch(repo, branch, local, target)
  else
    throw new Error(
      `${branch} has commits of its own that the pull request does not have. Rename or delete ${branch} to check out its latest version.`
    )
  await run(repo, ['checkout', '-q', branch, '--'])
}

/** Where the remote keeps a pull request's latest version. */
function pullRequestSource(
  pr: { number: number; sourceBranch: string; fromFork: boolean },
  provider: Provider
): string {
  if (provider === 'gitlab') return `refs/merge-requests/${pr.number}/head`
  if (provider !== 'bitbucket') return `refs/pull/${pr.number}/head`
  // Bitbucket keeps no pull request refs: only a branch of this same repository can be fetched.
  if (pr.fromFork) {
    throw new Error(
      'This pull request comes from a fork, which Bitbucket does not publish in this repository. Add the fork as a remote to fetch its branch.'
    )
  }
  assertSafeArg(pr.sourceBranch, 'branch')
  return `refs/heads/${pr.sourceBranch}`
}

/**
 * Fetches a pull request and its target branch for a review, leaving branches and the work tree alone: what it
 * brings is `base..head`, from the merge base with its target (later commits on the target are not part of it).
 */
export async function fetchPullRequestRange(
  repo: string,
  remote: string,
  pr: { number: number; sourceBranch: string; targetBranch: string; fromFork: boolean },
  provider: Provider
): Promise<{ base: string; head: string }> {
  assertSafeArg(remote, 'remote')
  assertSafeArg(pr.targetBranch, 'branch')
  if (!Number.isInteger(pr.number) || pr.number <= 0) throw new Error(`Invalid pull request number: ${pr.number}`)
  const source = pullRequestSource(pr, provider)
  // Not checkout's refs/leviathan/pulls/N: that one tells whether pr/N has commits of its own.
  const review = `${REVIEW_REFS}${pr.number}`
  // Reviews that did not end here (the app closed while one was open) leave theirs behind. Tidying up is no reason
  // for this review to fail (a ref locked by another git): what is left goes next time.
  await dropReviewRefs(repo, review).catch(() => {})
  const target = `refs/remotes/${remote}/${pr.targetBranch}`
  await git(['fetch', remote, `+${source}:${review}`, `+refs/heads/${pr.targetBranch}:${target}`], { cwd: repo })
  const head = await refValue(repo, review)
  if (!head) throw new Error('The pull request could not be fetched. Open it again.')
  const found = await git(['merge-base', target, head], { cwd: repo, okCodes: [0, 1] })
  if (found.exitCode !== 0) {
    throw new Error(
      `This pull request has no history in common with ${pr.targetBranch} here (unrelated histories, or a shallow clone).`
    )
  }
  return { base: found.stdout.trim(), head }
}

/** Where reviews keep the pull request they show, one ref per pull request number. */
const REVIEW_REFS = 'refs/leviathan/review/'

/** Deletes the review refs, all but `keep`: their commits are only needed while a review shows them. */
async function dropReviewRefs(repo: string, keep?: string): Promise<void> {
  const { stdout } = await git(['for-each-ref', '--format=%(refname)', REVIEW_REFS], { cwd: repo })
  const stale = stdout.split('\n').filter((ref) => ref && ref !== keep)
  if (stale.length) {
    await git(['update-ref', '--stdin'], { cwd: repo, input: stale.map((ref) => `delete ${ref}\n`).join('') })
  }
}

/** Ends a pull request's review: the ref holding its commits goes (they stay while anything else holds them). */
export async function endPullRequestReview(repo: string, number: number): Promise<void> {
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid pull request number: ${number}`)
  await git(['update-ref', '-d', `${REVIEW_REFS}${number}`], { cwd: repo })
}

/** Files changed between two commits (a pull request's review range), renames found. */
export async function getRangeFiles(repo: string, base: string, head: string): Promise<FileChange[]> {
  assertSafeArg(base, 'commit')
  assertSafeArg(head, 'commit')
  return parseNameStatus(await run(repo, ['diff', '--name-status', '-z', '-M', base, head, '--']))
}

const HISTORY_FORMAT = '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f'

/**
 * Commits that touched a file, newest first, following renames (`git log --follow`),
 * from HEAD or from `rev` (a commit of another branch).
 */
export async function getFileHistory(
  repo: string,
  path: string,
  rev: string | null = null,
  limit = HISTORY_PAGE
): Promise<FileCommit[]> {
  insideRepo(repo, path)
  if (rev !== null) assertSafeArg(rev, 'commit')
  const count = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), HISTORY_MAX) : HISTORY_PAGE
  const out = await run(
    repo,
    ['log', '--follow', `-n${count}`, `--format=${HISTORY_FORMAT}`, '--name-status', ...(rev ? [rev] : []), '--', path],
    {
      env: LITERAL_PATHS
    }
  )
  const history: FileCommit[] = []
  // Walking back in time: the path the file had in the next (older) commit.
  let current = path.replace(/\\/g, '/')
  for (const record of out.split('\x1e').slice(1)) {
    const f = record.split('\x1f')
    if (f.length < 10) continue
    const commit: Commit = {
      hash: f[0],
      parents: f[1] ? f[1].split(' ') : [],
      authorName: f[2],
      authorEmail: f[3],
      authorDate: Number(f[4]),
      committerName: f[5],
      committerEmail: f[6],
      commitDate: Number(f[7]),
      subject: f[8]
    }
    const change = f[9]
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .find((l) => l.includes('\t'))
    if (!change) {
      history.push({ commit, path: current, status: '' })
      continue
    }
    const [code, first, second] = change.split('\t')
    const status = code[0]
    if ((status === 'R' || status === 'C') && second) {
      history.push({ commit, path: second, oldPath: first, status })
    } else {
      history.push({ commit, path: first, status })
    }
    current = first
  }
  return history
}

/**
 * Commits that changed anything inside a folder, newest first, from HEAD or from `rev`. The files each one
 * changed come with its details (`getCommitDetails`), when one is picked.
 */
export async function getFolderHistory(
  repo: string,
  folder: string,
  rev: string | null = null,
  limit = HISTORY_PAGE
): Promise<Commit[]> {
  const path = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  // The whole repository's history is the graph.
  if (!path || path === '.') throw new Error('Pick a folder of the repository')
  insideRepo(repo, path)
  if (rev !== null) assertSafeArg(rev, 'commit')
  const count = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), HISTORY_MAX) : HISTORY_PAGE
  const out = await run(repo, ['log', `-n${count}`, `--format=${LOG_FORMAT}`, ...(rev ? [rev] : []), '--', path], {
    env: LITERAL_PATHS
  })
  return parseLog(out)
}

const BLAME_MAX_BYTES = 10 * 1024 * 1024

/** Blame of a binary or very large file would only run long and produce noise: refuse it up front. */
async function assertBlameable(repo: string, full: string, path: string, rev: string | null): Promise<void> {
  const tooLarge = new Error('This file is too large to blame here.')
  const binary = new Error('This is a binary file: it has no lines to blame.')
  if (rev === null) {
    const stat = await fs.lstat(full).catch(() => null)
    if (!stat?.isFile()) return
    if (stat.size > BLAME_MAX_BYTES) throw tooLarge
    const handle = await fs.open(full, 'r')
    try {
      const head = Buffer.alloc(Math.min(stat.size, 8000))
      await handle.read(head, 0, head.length, 0)
      if (head.includes(0)) throw binary
    } finally {
      await handle.close()
    }
    return
  }
  const object = `${rev}:${path.replace(/\\/g, '/')}`
  const size = await git(['cat-file', '-s', object], { cwd: repo, okCodes: [0, 128] })
  if (size.exitCode !== 0) return
  if (Number(size.stdout.trim()) > BLAME_MAX_BYTES) throw tooLarge
  const blob = await run(repo, ['cat-file', 'blob', object])
  if (blob.slice(0, 8000).includes('\0')) throw binary
}

/**
 * Who last changed each line of a file: as it is in the working tree (`rev`
 * null; lines not committed yet have an all-zeros hash) or in a commit.
 */
export async function getBlame(repo: string, path: string, rev: string | null): Promise<BlameLine[]> {
  const full = insideRepo(repo, path)
  if (rev !== null) assertSafeArg(rev, 'commit')
  await assertBlameable(repo, full, path, rev)
  const out = await run(repo, ['blame', '--porcelain', ...(rev ? [rev] : []), '--', path])
  if (out.includes('\0')) throw new Error('This is a binary file: it has no lines to blame.')
  const info = new Map<string, Pick<BlameLine, 'author' | 'date' | 'summary' | 'previous'>>()
  const lines: BlameLine[] = []
  let current: { hash: string; line: number; origLine: number } | null = null
  for (const raw of out.split('\n')) {
    if (raw.startsWith('\t')) {
      if (current) {
        const meta = info.get(current.hash)!
        lines.push({ ...current, ...meta, text: raw.slice(1).replace(/\r$/, '') })
        if (lines.length >= BLAME_MAX_LINES) break
      }
      current = null
      continue
    }
    // <hash> <line in that commit> <line now> [<lines in the group>]
    const header = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)/.exec(raw)
    if (!current && header) {
      current = { hash: header[1], origLine: Number(header[2]), line: Number(header[3]) }
      if (!info.has(current.hash)) info.set(current.hash, { author: '', date: 0, summary: '' })
      continue
    }
    if (!current) continue
    const space = raw.indexOf(' ')
    const key = space < 0 ? raw : raw.slice(0, space)
    const value = space < 0 ? '' : raw.slice(space + 1)
    const meta = info.get(current.hash)!
    if (key === 'author') meta.author = value
    else if (key === 'author-time') meta.date = Number(value)
    else if (key === 'summary') meta.summary = value
    else if (key === 'previous') {
      // previous <hash> <path>: the path may have spaces.
      const gap = value.indexOf(' ')
      if (gap > 0) meta.previous = { hash: value.slice(0, gap), path: unquotePath(value.slice(gap + 1)) }
    }
  }
  return lines
}

/** Brings a branch that is not checked out up to date with its upstream; fast-forward only. */
export async function pullBranch(repo: string, branch: string, onProgress: ProgressFn): Promise<void> {
  assertSafeArg(branch, 'branch')
  const remote = await configValue(repo, `branch.${branch}.remote`)
  const merge = await configValue(repo, `branch.${branch}.merge`)
  if (!remote || !merge) throw new Error(`${branch} has no upstream branch to pull from.`)
  assertSafeArg(remote, 'remote')
  try {
    // Without a leading `+`, git only accepts a fast-forward (and updates the remote-tracking branch too).
    await git(['fetch', '--progress', remote, `${merge}:refs/heads/${branch}`], { cwd: repo, onProgress })
  } catch (err) {
    if (err instanceof GitError && /non-fast-forward/.test(err.stderr)) {
      throw new Error(`${branch} has commits its upstream does not have. To combine them, check it out and pull.`)
    }
    throw err
  }
}

export async function push(
  repo: string,
  opts: { force: boolean; branch?: string; remote?: string },
  onProgress: ProgressFn
): Promise<void> {
  let branch = opts.branch
  if (!branch) {
    const { head } = parseStatus(
      await run(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=no'])
    )
    if (!head.branch) throw new Error('HEAD is detached: check out a branch before pushing')
    branch = head.branch
  }
  assertSafeArg(branch, 'branch name')

  const args = ['push', '--progress']
  if (opts.force) args.push('--force-with-lease')

  const upstreamRemote = await configValue(repo, `branch.${branch}.remote`)
  const upstreamMerge = await configValue(repo, `branch.${branch}.merge`)
  // Only reuse the upstream when it has the same name: a branch created from
  // origin/main tracks main, and pushing there would overwrite someone else's branch.
  const sameName = upstreamMerge === `refs/heads/${branch}`
  if (upstreamRemote && sameName && !opts.remote) {
    args.push(upstreamRemote, `refs/heads/${branch}:refs/heads/${branch}`)
  } else {
    const remotes = parseRemotes(await run(repo, ['remote', '-v'])).map((r) => r.name)
    const preferred = upstreamRemote && remotes.includes(upstreamRemote) ? upstreamRemote : null
    const remote = opts.remote ?? preferred ?? (remotes.includes('origin') ? 'origin' : remotes[0])
    if (!remote) throw new Error('This repository has no remotes. Add one first.')
    assertSafeArg(remote, 'remote')
    args.push('--set-upstream', remote, `refs/heads/${branch}:refs/heads/${branch}`)
  }
  await git(args, { cwd: repo, onProgress })
}

export async function pushTag(repo: string, remote: string, tag: string, onProgress: ProgressFn): Promise<void> {
  assertSafeArg(remote, 'remote')
  assertSafeArg(tag, 'tag')
  await git(['push', '--progress', remote, `refs/tags/${tag}`], { cwd: repo, onProgress })
}

export async function addRemote(repo: string, name: string, url: string): Promise<void> {
  assertSafeArg(name, 'remote name')
  assertSafeArg(url, 'URL')
  await run(repo, ['remote', 'add', name, url])
}

export async function removeRemote(repo: string, name: string): Promise<void> {
  assertSafeArg(name, 'remote name')
  await run(repo, ['remote', 'remove', name])
}

// ---------------------------------------------------------------------------
// Undo / redo

async function currentHead(repo: string): Promise<HeadState> {
  const sym = await git(['symbolic-ref', '-q', 'HEAD'], { cwd: repo, okCodes: [0, 1] })
  const branch = sym.exitCode === 0 ? sym.stdout.trim().replace(/^refs\/heads\//, '') : null
  const head: HeadState = { branch, hash: await refValue(repo, 'HEAD') }
  const mergeHead = await fs.readFile(join(await gitDir(repo), 'MERGE_HEAD'), 'utf8').catch(() => '')
  const merge = mergeHead.split(/\r?\n/).filter(Boolean)
  if (merge.length) head.merge = merge
  return head
}

async function refValue(repo: string, ref: string): Promise<string | null> {
  const { stdout, exitCode } = await git(['rev-parse', '-q', '--verify', ref], { cwd: repo, okCodes: [0, 1] })
  return exitCode === 0 ? stdout.trim() : null
}

/** `branch.<name>.<key>` settings of the repository, by branch name. */
async function branchConfig(repo: string): Promise<Record<string, BranchConfig>> {
  const { stdout } = await git(['config', '--local', '-z', '--get-regexp', '^branch\\.'], {
    cwd: repo,
    okCodes: [0, 1]
  })
  const config: Record<string, BranchConfig> = {}
  for (const entry of stdout.split('\0')) {
    // `key\nvalue`; a bare key is a boolean set to true.
    const nl = entry.indexOf('\n')
    const key = nl < 0 ? entry : entry.slice(0, nl)
    const dot = key.lastIndexOf('.')
    if (dot <= 'branch.'.length) continue
    const name = key.slice('branch.'.length, dot)
    ;(config[name] ??= []).push([key.slice(dot + 1), nl < 0 ? 'true' : entry.slice(nl + 1)])
  }
  return config
}

/** Every local branch and tag (unpeeled, so annotated tags can be restored) plus HEAD. */
export async function getSnapshot(repo: string): Promise<Snapshot> {
  const [out, head, config] = await Promise.all([
    run(repo, ['for-each-ref', '--format=%(refname)%1f%(objectname)', 'refs/heads', 'refs/tags']),
    currentHead(repo),
    branchConfig(repo)
  ])
  const refs: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const [ref, hash] = line.replace(/\r$/, '').split('\x1f')
    if (ref && hash) refs[ref] = hash
  }
  return { head, refs, config }
}

async function moveRef(repo: string, move: RefMove): Promise<void> {
  assertSafeArg(move.ref, 'ref')
  if (move.to === null) await run(repo, ['update-ref', '-d', move.ref])
  else await run(repo, ['update-ref', move.ref, move.to])
  if (!move.ref.startsWith('refs/heads/') || (move.from !== null && move.to !== null)) return
  // A branch appears or disappears: its settings (upstream, ...) go with it.
  const section = `branch.${move.ref.slice('refs/heads/'.length)}`
  await git(['config', '--local', '--remove-section', section], { cwd: repo, okCodes: [0, 128] })
  if (move.to === null) return
  for (const [key, value] of move.config ?? []) {
    await run(repo, ['config', '--local', '--add', `${section}.${key}`, value])
  }
}

const MERGE_STATE = ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE', 'AUTO_MERGE']

/**
 * Applies a recorded change (forwards for redo, inverted for undo). Refuses when
 * the repository is no longer in the state the change starts from or an operation
 * is in progress, and moves HEAD only with `reset --soft` / `--mixed` / `--keep`,
 * which never drop uncommitted work.
 */
export async function applyChange(repo: string, change: RepoChange): Promise<void> {
  const { from, to } = change.head
  // Redoing the commit that concluded a merge is the one change allowed while merging.
  const concludesMerge =
    change.mode === 'soft' && from.branch === to.branch && !!from.merge && !to.merge && !!from.hash && !!to.hash
  const operation = await currentOperation(repo)
  if (operation && !(operation === 'merge' && concludesMerge)) {
    throw new Error(`A ${operation} is in progress. Finish or abort it first.`)
  }

  const changed = new Error('The repository changed since this action, so it can no longer be undone.')
  const head = await currentHead(repo)
  if (head.branch !== from.branch || head.hash !== from.hash) throw changed
  if (String(head.merge ?? '') !== String(from.merge ?? '')) throw changed
  for (const move of change.refs) {
    if ((await refValue(repo, move.ref)) !== move.from) throw changed
  }

  const startRef = from.branch ? `refs/heads/${from.branch}` : null
  if (from.branch === to.branch) {
    if (change.refs.some((m) => m.ref === startRef && m.to === null)) {
      throw new Error('The checked-out branch cannot be deleted')
    }
    for (const move of change.refs) if (move.ref !== startRef) await moveRef(repo, move)
    if (to.hash && to.hash !== from.hash) {
      if (concludesMerge) {
        // `reset --soft` refuses mid-merge; moving HEAD is all a soft reset does.
        await run(repo, ['update-ref', 'HEAD', to.hash, from.hash!])
        const dir = await gitDir(repo)
        await Promise.all(MERGE_STATE.map((f) => fs.rm(join(dir, f), { force: true })))
      } else {
        await run(repo, ['reset', '-q', `--${change.mode}`, to.hash])
      }
    }
    if (change.mode === 'soft' && to.merge && !from.merge && from.hash) {
      // Undoing a merge commit: bring back the merge it concluded, ready to commit again.
      const message = await run(repo, ['log', '-1', '--format=%B', from.hash])
      const dir = await gitDir(repo)
      await fs.writeFile(join(dir, 'MERGE_HEAD'), to.merge.join('\n') + '\n')
      await fs.writeFile(join(dir, 'MERGE_MSG'), message)
    }
    return
  }

  // HEAD moves: create/move the target refs, switch, then update the branch we left and delete refs.
  const later = change.refs.filter((m) => m.ref === startRef || m.to === null)
  for (const move of change.refs) if (!later.includes(move)) await moveRef(repo, move)
  if (to.branch) await run(repo, ['checkout', '-q', to.branch, '--'])
  else if (to.hash) await run(repo, ['checkout', '-q', '--detach', to.hash])
  for (const move of later) await moveRef(repo, move)
}

// ---------------------------------------------------------------------------
// Conflict resolution

/**
 * Whole content of a working-tree file for the conflict editor, or why it cannot
 * be edited as text without damaging it.
 */
export async function readWorkingFile(repo: string, path: string): Promise<WorkingFile> {
  const full = insideRepo(repo, path)
  // lstat: never follow a symlink, its target may live outside the repository.
  const stat = await fs.lstat(full)
  if (!stat.isFile()) return { text: null, reason: 'binary' }
  if (stat.size > MAX_FILE_PREVIEW) return { text: null, reason: 'large' }
  const buffer = await fs.readFile(full)
  if (buffer.subarray(0, 8000).includes(0)) return { text: null, reason: 'binary' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer), reason: null }
  } catch {
    return { text: null, reason: 'encoding' }
  }
}

/** Index stages of a conflicted path (1 base, 2 ours, 3 theirs); empty once resolved. */
async function conflictStages(repo: string, path: string): Promise<{ mode: string; hash: string; stage: string }[]> {
  insideRepo(repo, path)
  const out = await run(repo, ['ls-files', '-u', '-z', '--', path], { env: LITERAL_PATHS })
  const stages = out
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [mode, hash, stage] = entry.slice(0, entry.indexOf('\t')).split(' ')
      return { mode, hash, stage }
    })
  if (!stages.length) throw new Error(`${path} is no longer in conflict.`)
  return stages
}

/**
 * Writes the resolved content and marks the file resolved. `original` is the text
 * the resolution was made from; the save is refused if the file changed since.
 */
export async function resolveConflictFile(
  repo: string,
  path: string,
  content: string,
  original: string
): Promise<void> {
  await conflictStages(repo, path)
  if ((await readWorkingFile(repo, path)).text !== original) {
    throw new Error(`${path} changed since it was opened. Reopen it to see the latest version.`)
  }
  await fs.writeFile(insideRepo(repo, path), content, 'utf8')
  await run(repo, ['add', '--', path], { env: LITERAL_PATHS })
}

/** A conflicted file's text with LF line ends and bare markers: how git left it, whatever it named the sides. */
function conflictShape(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^(<{7}|\|{7}|>{7}) .*$/gm, '$1')
}

/**
 * Whether a conflicted file is no longer what git left in it (edited by hand since, or not known to be untouched):
 * taking a whole side would lose those edits. What git left is made again from the index stages.
 */
export async function conflictFileEdited(repo: string, path: string): Promise<boolean> {
  const stages = await conflictStages(repo, path)
  const stage = (n: string) => stages.find((s) => s.stage === n)
  const [base, ours, theirs] = [stage('1'), stage('2'), stage('3')]
  // A submodule has no file to edit.
  if ([base, ours, theirs].some((s) => s?.mode === '160000')) return false
  const working = await fs.readFile(insideRepo(repo, path), 'utf8').catch(() => null)
  const blob = (hash: string) => run(repo, ['cat-file', 'blob', hash])
  let left: string | null = null
  if (ours && theirs) {
    // Both sides added the file: git merges them against an empty base.
    const baseHash =
      base?.hash ?? (await run(repo, ['hash-object', '-w', '-t', 'blob', '--stdin'], { input: '' })).trim()
    const merged = await git(['merge-file', '--object-id', '-p', ours.hash, baseHash, theirs.hash], {
      cwd: repo,
      // The exit code is the number of conflicts.
      okCodes: Array.from({ length: 128 }, (_, i) => i)
    }).catch(() => null)
    // Binary files cannot be merged: git leaves the checked-out side.
    left = merged ? merged.stdout : await blob(ours.hash)
  } else if (ours ?? theirs) {
    // One side deleted the file: git leaves the other side's version.
    left = await blob((ours ?? theirs)!.hash)
  }
  if (working === null || left === null) return working !== left
  return conflictShape(working) !== conflictShape(left)
}

/**
 * Resolves a conflict with one side of the whole file. When that side deleted
 * the file (no index stage for it), the deletion is taken.
 */
export async function resolveConflictWith(repo: string, path: string, side: 'ours' | 'theirs'): Promise<void> {
  const wanted = (await conflictStages(repo, path)).find((s) => s.stage === (side === 'ours' ? '2' : '3'))
  if (!wanted) {
    await run(repo, ['rm', '-q', '--', path], { env: LITERAL_PATHS })
  } else if (wanted.mode === '160000') {
    // A submodule: checkout cannot pick its side, so record that side's commit directly.
    await run(repo, ['update-index', '--cacheinfo', wanted.mode, wanted.hash, path])
  } else {
    await run(repo, ['checkout', `--${side}`, '--', path], { env: LITERAL_PATHS })
    await run(repo, ['add', '--', path], { env: LITERAL_PATHS })
  }
}
