import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
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
import {
  parseBisectRefs,
  parseBisectTerms,
  parseBisectVars,
  type BisectMark,
  type BisectState
} from '../../shared/bisect'
import { parseCommitTemplate, type CommitDraftText } from '../../shared/commitTemplate'
import { parseChangesBlock, type ChangesBlock } from '../../shared/localChanges'
import { unchangedGaps } from '../../shared/diffGaps'
import {
  IMAGE_PREVIEW_MAX,
  imageType,
  parseLfsPointer,
  TGA_TYPE,
  type ImagePair,
  type ImageVersion
} from '../../shared/images'
import { decodeTga } from '../../shared/tga'
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
  RebaseList,
  RepoOperation,
  RepoState,
  ResetMode,
  SubmoduleChange,
  WorkingFile
} from '../../shared/types'
import { BLAME_MAX_LINES, HISTORY_MAX, HISTORY_PAGE } from '../../shared/types'
import {
  REBASE_ACTIONS,
  parseRebaseScript,
  planRebase,
  planRebaseWithMerges,
  rebaseProblem,
  rebaseProblemWithMerges,
  shQuote,
  type RebaseItem
} from '../../shared/rebase'
import type {
  BranchConfig,
  FileMove,
  FileVersion,
  HeadState,
  RefMove,
  RepoChange,
  Snapshot,
  StashEntry
} from '../../shared/undo'
import { encodePng } from '../png'
import { listRefs } from './refs'
import { GitError, NON_INTERACTIVE_ENV, git, holdingIndex } from './runner'
import { lfsFilesAmong, plainLfs, POINTER_MAX_BYTES, stagedBlobs } from './staged'

export type ProgressFn = (line: string) => void

const MAX_FILE_PREVIEW = 2 * 1024 * 1024

export async function run(
  repo: string,
  args: string[],
  extra: Partial<Parameters<typeof git>[1]> = {}
): Promise<string> {
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

export function assertSafeArg(value: string, what: string): void {
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

export async function gitDir(repo: string): Promise<string> {
  let dir = gitDirs.get(repo)
  if (!dir) {
    dir = (await run(repo, ['rev-parse', '--absolute-git-dir'])).trim()
    gitDirs.set(repo, dir)
  }
  return dir
}

export async function currentOperation(repo: string): Promise<RepoOperation> {
  const dir = await gitDir(repo)
  if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) return 'rebase'
  if (existsSync(join(dir, 'MERGE_HEAD'))) return 'merge'
  if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (existsSync(join(dir, 'REVERT_HEAD'))) return 'revert'
  return null
}

/** The bisect under way, or null: what it started from, the commits marked, what is left, and what it found. */
async function currentBisect(repo: string): Promise<BisectState | null> {
  const dir = await gitDir(repo)
  const start = await fs.readFile(join(dir, 'BISECT_START'), 'utf8').catch(() => null)
  if (start === null) return null
  const terms = parseBisectTerms(await fs.readFile(join(dir, 'BISECT_TERMS'), 'utf8').catch(() => ''))
  const marks = parseBisectRefs(
    await run(repo, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/bisect/']),
    terms
  )
  const state: BisectState = {
    start: start.trim(),
    terms,
    ...marks,
    left: null,
    steps: null,
    firstBad: null,
    suspects: null,
    crossed: false
  }
  if (!marks.bad || !marks.good.length) return state
  const range = [marks.bad, '--not', ...marks.good, '--']
  // Exit code 1 for nothing to list.
  const vars = parseBisectVars(await run(repo, ['rev-list', '--bisect-vars', ...range], { okCodes: [0, 1] }))
  // Nothing at all: the bad one is in the history of a good one (git said "Some good revs are not ancestors...").
  if (vars.all === 0) return { ...state, crossed: true }
  // Only the bad one left: it is the first.
  if (vars.all === 1) return { ...state, left: 0, steps: 0, firstBad: marks.bad }
  if (vars.all - 1 <= marks.skipped.length) {
    // Maybe only skipped ones left: then git cannot tell which of them is the first.
    const candidates = (await run(repo, ['rev-list', ...range])).split('\n').filter(Boolean)
    const skipped = new Set(marks.skipped)
    if (candidates.every((c) => c === marks.bad || skipped.has(c)))
      return { ...state, left: 0, steps: 0, suspects: candidates }
  }
  return { ...state, left: vars.left, steps: vars.steps }
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
  const [statusOut, remotesOut, refsOut, stashOut, operation, bisect] = await Promise.all([
    run(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']).then((out) => {
      statusMs = Date.now() - statusStart
      return out
    }),
    run(repo, ['remote', '-v']),
    listRefs(repo),
    run(repo, ['stash', 'list', `--format=${STASH_FORMAT}`]),
    currentOperation(repo),
    currentBisect(repo)
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
    bisect,
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

/** What `git log` walks for the graph's `scope` (`input`: refs given on stdin); null when there is nothing to walk. */
async function logRevs(repo: string, scope: LogScope): Promise<{ revs: string[]; input?: string } | null> {
  const isRef = (r: unknown): r is string => typeof r === 'string' && r.startsWith('refs/') && !/\s/.test(r)
  const hidden = new Set((scope.hidden ?? []).filter(isRef))
  const solo = isRef(scope.solo) && (await refValue(repo, scope.solo)) ? scope.solo : null
  if (solo) return { revs: [solo] }
  if (hidden.size) {
    // Every ref but the hidden ones, through stdin: there can be thousands.
    const all = (await run(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']))
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r && !hidden.has(r))
    const head = await currentHead(repo)
    if (head.hash && !(head.branch && hidden.has(`refs/heads/${head.branch}`))) all.push('HEAD')
    if (!all.length) return null
    return { revs: ['--stdin'], input: all.join('\n') + '\n' }
  }
  // Decide what to log up front instead of parsing (localised) error messages:
  // HEAD may be unborn (new repo, orphan branch) while other branches exist.
  const revs = ['--branches', '--remotes', '--tags']
  if (await hasHead(repo)) return { revs: [...revs, 'HEAD'] }
  const anyRef = await run(repo, [
    'for-each-ref',
    '--count=1',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes',
    'refs/tags'
  ])
  return anyRef.trim() ? { revs } : null
}

export async function getLog(
  repo: string,
  limit: number,
  scope: LogScope = {}
): Promise<{ commits: Commit[]; hasMore: boolean }> {
  const walk = await logRevs(repo, scope)
  if (!walk) return { commits: [], hasMore: false }
  const out = await run(
    repo,
    ['log', '--date-order', `--max-count=${limit + 1}`, `--format=${LOG_FORMAT}`, ...walk.revs, '--'],
    { input: walk.input }
  )
  const commits = parseLog(out)
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit }
}

/** Commits a search in what commits change returns at most. */
export const CHANGE_SEARCH_MAX = 1000

/**
 * The commits of the graph's `scope` that add or remove `text` (`git log -S`, ignoring case), newest first, at most
 * `CHANGE_SEARCH_MAX` (`more` when there are others). It reads every commit's diff: `signal` stops it.
 */
export async function searchChanges(
  repo: string,
  text: string,
  scope: LogScope = {},
  signal?: AbortSignal
): Promise<{ hashes: string[]; more: boolean }> {
  if (!text || /[\0\r\n]/.test(text)) throw new Error('Invalid search')
  const walk = await logRevs(repo, scope)
  if (!walk) return { hashes: [], more: false }
  const out = await run(
    repo,
    [
      'log',
      '--date-order',
      '-i',
      `-S${text}`,
      `--max-count=${CHANGE_SEARCH_MAX + 1}`,
      '--format=%H',
      ...walk.revs,
      '--'
    ],
    { input: walk.input, signal }
  )
  const hashes = out.split('\n').filter(Boolean)
  return { hashes: hashes.slice(0, CHANGE_SEARCH_MAX), more: hashes.length > CHANGE_SEARCH_MAX }
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
    case 'tree': {
      assertSafeArg(source.base, 'commit')
      if (source.untracked) {
        // Not tracked: all of it is new, as in the uncommitted changes.
        const { binary, content } = await readPreview(repo, source.path)
        if (binary) return { path: source.path, binary: true, header: '', hunks: [] }
        return untrackedDiff(source.path, content)
      }
      const paths = source.oldPath ? [source.oldPath, source.path] : [source.path]
      const out = await run(repo, ['diff', ...diffArgs, source.base, '--', ...paths], { env: LITERAL_PATHS })
      return parseDiff(out, source.path)
    }
  }
}

// ---------------------------------------------------------------------------
// Images

/** Where an image comes from: a blob (`<commit>:<path>`, `:<path>` for the index) or the file in the folder. */
type ImageSide = { blob: string } | { file: string }

/**
 * An image change's two sides as `source` says (those of the diff), to show instead of the diff. A Git LFS file is
 * shown through its object downloaded here, never fetched.
 */
export async function getImages(repo: string, source: DiffSource, maxBytes = IMAGE_PREVIEW_MAX): Promise<ImagePair> {
  const type = imageType(source.path)
  if (!type) throw new Error(`Not an image: ${source.path}`)
  const [before, after] = await Promise.all(
    imageSides(source).map((side) => (side ? imageVersion(repo, side, type, maxBytes) : null))
  )
  return { before, after }
}

function imageSides(source: DiffSource): (ImageSide | null)[] {
  switch (source.kind) {
    case 'unstaged':
      if (source.untracked) return [null, { file: source.path }]
      // Conflicted: the current side against the incoming one (the index's stages 2 and 3).
      if (source.conflicted) return [{ blob: `:2:${source.path}` }, { blob: `:3:${source.path}` }]
      return [{ blob: `:${source.path}` }, { file: source.path }]
    case 'staged':
      return [{ blob: `HEAD:${source.path}` }, { blob: `:${source.path}` }]
    case 'commit':
      assertSafeArg(source.hash, 'commit')
      if (source.untracked) return [null, { blob: `${source.hash}^3:${source.path}` }]
      if (source.parent) assertSafeArg(source.parent, 'commit')
      return [
        source.parent ? { blob: `${source.parent}:${source.oldPath ?? source.path}` } : null,
        { blob: `${source.hash}:${source.path}` }
      ]
    case 'tree':
      assertSafeArg(source.base, 'commit')
      return [{ blob: `${source.base}:${source.oldPath ?? source.path}` }, { file: source.path }]
  }
}

/** One side of an image change, or null where the file does not exist. */
async function imageVersion(
  repo: string,
  side: ImageSide,
  type: string,
  maxBytes: number
): Promise<ImageVersion | null> {
  let content: Buffer
  if ('file' in side) {
    const full = insideRepo(repo, side.file)
    // lstat: never follow a symlink, its target may live outside the repository.
    const stat = await fs.lstat(full).catch(() => null)
    if (!stat?.isFile()) return null
    if (stat.size > maxBytes) return { url: null, bytes: stat.size, missing: 'large' }
    content = await fs.readFile(full)
  } else {
    const { stdout, exitCode } = await git(['cat-file', '-s', side.blob], { cwd: repo, okCodes: [0, 128] })
    if (exitCode !== 0) return null
    const size = Number(stdout.trim())
    if (size > maxBytes) return { url: null, bytes: size, missing: 'large' }
    content = (await git(['cat-file', 'blob', side.blob], { cwd: repo, binary: true })).bytes!
  }
  // Through Git LFS the file is stored as a pointer: its content is the object it stands for.
  const pointer = content.length <= POINTER_MAX_BYTES ? parseLfsPointer(content.toString('utf8')) : null
  if (pointer) {
    if (pointer.size > maxBytes) return { url: null, bytes: pointer.size, missing: 'large' }
    const object = await readLfsObject(repo, pointer.oid)
    if (!object) return { url: null, bytes: pointer.size, missing: 'lfs' }
    content = object
  }
  if (type === TGA_TYPE) {
    // The window cannot draw a TGA: it gets the pixels as a PNG.
    try {
      const { width, height, rgba } = decodeTga(content)
      const png = await encodePng(width, height, rgba)
      return { url: `data:image/png;base64,${png.toString('base64')}`, bytes: content.length }
    } catch {
      return { url: null, bytes: content.length, missing: 'unreadable' }
    }
  }
  return { url: `data:${type};base64,${content.toString('base64')}`, bytes: content.length }
}

/** A Git LFS object downloaded here (git-lfs keeps them in `lfs/objects` of the git folder, or in `lfs.storage`). */
async function readLfsObject(repo: string, oid: string): Promise<Buffer | null> {
  const common = resolve(repo, (await run(repo, ['rev-parse', '--git-common-dir'])).trim())
  const storage = await configValue(repo, 'lfs.storage')
  const root = storage ? resolve(common, storage) : join(common, 'lfs')
  return fs.readFile(join(root, 'objects', oid.slice(0, 2), oid.slice(2, 4), oid)).catch(() => null)
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

/**
 * Puts files back as HEAD has them, staged changes included (a file HEAD does not have goes away), and deletes
 * the untracked ones: what was in the way of a checkout.
 */
export async function restoreFromHead(repo: string, paths: string[], untracked: string[]): Promise<void> {
  if (paths.length) {
    const ps = pathspecInput(paths)
    await run(repo, ['restore', '--source=HEAD', '--staged', '--worktree', ...ps.args], ps.opts)
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

/** `noSign`: not signed this once, whatever `commit.gpgsign` says. */
export async function commit(repo: string, message: string, amend: boolean, noSign = false): Promise<void> {
  const args = ['commit', '-q']
  if (amend) args.push('--amend')
  if (noSign) args.push('--no-gpg-sign')
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

/**
 * Runs a checkout, merge, pull, rebase, cherry-pick or revert. Uncommitted changes in its way come back as what
 * blocked it instead of an error, when git changed nothing (no operation left under way); git's message is read in
 * English for that.
 */
async function unlessBlocked(
  repo: string,
  args: string[],
  extra: Partial<Parameters<typeof git>[1]> = {}
): Promise<ChangesBlock | null> {
  try {
    await git(args, { cwd: repo, ...extra, env: { ...extra.env, LC_ALL: 'C', LANGUAGE: 'C' } })
    return null
  } catch (err) {
    const block = err instanceof GitError ? parseChangesBlock(err.stderr) : null
    // A rebase that stopped part-way says the same of the commit it could not apply: it did start.
    if (!block || (await currentOperation(repo))) throw err
    return { message: (err as GitError).message, ...block }
  }
}

export async function checkout(repo: string, ref: string): Promise<ChangesBlock | null> {
  assertSafeArg(ref, 'ref')
  return unlessBlocked(repo, ['checkout', '-q', ref, '--'])
}

export async function checkoutRemote(repo: string, remoteBranch: string): Promise<ChangesBlock | null> {
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
  if (exitCode === 0) return unlessBlocked(repo, ['checkout', '-q', local, '--'])
  return unlessBlocked(repo, ['checkout', '-q', '-b', local, '--track', remoteBranch])
}

export async function checkoutDetached(repo: string, hash: string): Promise<ChangesBlock | null> {
  assertSafeArg(hash, 'commit')
  return unlessBlocked(repo, ['checkout', '-q', '--detach', hash])
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

/** For each local branch, how many of its commits no other branch, remote branch or tag has (deleting it loses them). */
export async function commitsOnlyOn(repo: string, names: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const name of names) {
    await assertBranchName(repo, name)
    // Branch names cannot hold glob characters, so `--exclude` leaves out this branch alone.
    const out = await run(repo, [
      'rev-list',
      '--count',
      `refs/heads/${name}`,
      '--not',
      `--exclude=${name}`,
      '--branches',
      '--remotes',
      '--tags'
    ])
    counts[name] = Number(out.trim())
  }
  return counts
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

export async function merge(repo: string, ref: string): Promise<ChangesBlock | null> {
  assertSafeArg(ref, 'ref')
  return unlessBlocked(repo, ['merge', '--no-edit', ref])
}

/**
 * A merge of `ref` as one change: its commits' changes are staged, to be committed as one commit (`--squash`); no
 * merge is left under way.
 */
export async function mergeSquash(repo: string, ref: string): Promise<ChangesBlock | null> {
  assertSafeArg(ref, 'ref')
  return unlessBlocked(repo, ['merge', '--squash', ref])
}

/** What a squash merge of `ref` brings: the subjects of its commits not on HEAD (oldest first), and the files they change. */
export async function squashInfo(repo: string, ref: string): Promise<{ subjects: string[]; paths: string[] }> {
  assertSafeArg(ref, 'ref')
  const subjects = await run(repo, ['log', '--reverse', '--no-merges', '-n', '200', '--format=%s', `HEAD..${ref}`])
  const paths = await run(repo, ['diff', '--name-only', '-z', '--no-renames', `HEAD...${ref}`, '--'])
  return { subjects: subjects.split('\n').filter(Boolean), paths: paths.split('\0').filter(Boolean) }
}

export async function rebase(repo: string, onto: string): Promise<ChangesBlock | null> {
  assertSafeArg(onto, 'ref')
  return unlessBlocked(repo, ['rebase', onto])
}

/** The commits an interactive rebase onto `base` would rewrite (`base..HEAD`), oldest first. */
export async function getRebaseCommits(repo: string, base: string): Promise<RebaseList> {
  assertSafeArg(base, 'commit')
  const ancestor = await git(['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: repo, okCodes: [0, 1] })
  if (ancestor.exitCode !== 0) throw new Error('That commit is not part of the current branch.')
  const merges = (await run(repo, ['rev-list', '--merges', `${base}..HEAD`])).trim()
  const out = await run(repo, [
    'log',
    '--reverse',
    '--no-merges',
    '-z',
    '--format=%H%x1f%an%x1f%at%x1f%B',
    `${base}..HEAD`
  ])
  const commits = out
    .split('\0')
    .filter((entry) => entry.trim())
    .map((entry) => {
      const [hash, author, date, body = ''] = entry.replace(/^\n/, '').split('\x1f')
      const message = body.trimEnd()
      return { hash, author, date: Number(date), message, subject: message.split('\n')[0] }
    })
  if (!commits.length) throw new Error('There are no commits after that one.')
  if (!merges) return { commits, script: null }
  // With merges, git's own list says how they are made again: the commits come in its order.
  const script = await rebaseScript(repo, base)
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const order = parseRebaseScript(script, commits).flatMap((line) => (line.kind === 'pick' ? [line.hash] : []))
  return { commits: order.map((hash) => byHash.get(hash)!), script }
}

/**
 * The list `git rebase -i --rebase-merges` starts from. git makes it; an editor keeps a copy and fails, so the rebase
 * stops before doing anything. It runs in a throwaway clone sharing the repository's objects, with no file checked
 * out (a sparse checkout of nothing): whatever is uncommitted here does not stop it, and nothing here changes, not
 * even for a moment. Hooks are off there: a checkout or pre-rebase hook must not run for a list.
 */
async function rebaseScript(repo: string, base: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'leviathan-rebase-list-'))
  const probe = join(dir, 'probe')
  const hooks = join(dir, 'hooks')
  const copy = join(dir, 'todo').replace(/\\/g, '/')
  try {
    await fs.mkdir(hooks)
    const head = (await run(repo, ['rev-parse', 'HEAD'])).trim()
    await git(['clone', '-q', '--shared', '--no-checkout', '--no-tags', repo, probe], { cwd: dir })
    // Over the user's own config: no hook at all, and no `update-ref` line for the clone's copy of the branch
    // (rebase.updateRefs), which the rebase here, moving that branch itself, would fail to update at the end.
    await git(['config', 'core.hooksPath', hooks.replace(/\\/g, '/')], { cwd: probe })
    await git(['config', 'rebase.updateRefs', 'false'], { cwd: probe })
    await git(['sparse-checkout', 'set', '--no-cone', '/.leviathan-none'], { cwd: probe })
    await git(['checkout', '-q', '--detach', head], { cwd: probe })
    await git(['rebase', '-i', '--rebase-merges', base], {
      cwd: probe,
      okCodes: [0, 1, 128],
      env: { GIT_SEQUENCE_EDITOR: `f() { cp "$1" ${shQuote(copy)}; exit 1; }; f` }
    })
    const script = await fs.readFile(copy, 'utf8').catch(() => null)
    if (script === null) throw new Error('git did not make the list of this rebase.')
    return script
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/**
 * Rewrites `base..HEAD` as `items` says. No editor is opened: git copies a todo
 * list written beforehand, and rewords read their message from a file. Stops,
 * like any rebase, when a commit does not apply cleanly.
 */
export async function interactiveRebase(repo: string, base: string, items: RebaseItem[]): Promise<ChangesBlock | null> {
  const operation = await currentOperation(repo)
  if (operation) throw new Error(`A ${operation} is in progress. Finish or abort it first.`)
  // As git refuses a rebase: any uncommitted change of a tracked file is in its way.
  if ((await run(repo, ['status', '--porcelain', '--untracked-files=no'])).trim()) {
    const message = 'Commit or stash your uncommitted changes before rebasing.'
    return { message, changed: [], untracked: [], folders: [], all: true }
  }
  if (items.some((i) => !REBASE_ACTIONS.includes(i.action))) throw new Error('Unknown rebase action')
  // The list was read earlier: it must still be exactly the commits to rewrite.
  const { commits, script } = await getRebaseCommits(repo, base)
  const lines = script === null ? null : parseRebaseScript(script, commits)
  const problem = lines ? rebaseProblemWithMerges(lines, items) : rebaseProblem(items)
  if (problem) throw new Error(`This rebase cannot run (${problem}).`)
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
  const messageOf = (hash: string) => messages.get(hash) ?? ''
  // With merges, git's own list keeps them (its order: commits are not moved across them).
  const plan = lines ? planRebaseWithMerges(lines, items, messageOf, file) : planRebase(items, messageOf, file)
  for (const [name, text] of Object.entries(plan.files)) await fs.writeFile(file(name), text, 'utf8')
  await fs.writeFile(file('todo'), plan.todo, 'utf8')
  // A failed step (a reword's amend, say) runs again on continue instead of being skipped.
  await run(repo, ['rebase', '-i', ...(lines ? ['--rebase-merges'] : []), '--reschedule-failed-exec', base], {
    env: { GIT_SEQUENCE_EDITOR: `cp ${shQuote(file('todo'))}` }
  })
  await removeRebaseFiles(repo)
  return null
}

/** The todo list and messages of an interactive rebase, once no rebase needs them any more. */
async function removeRebaseFiles(repo: string): Promise<void> {
  if ((await currentOperation(repo)) === 'rebase') return
  // Best effort: an antivirus holding one of the files for a moment must not turn success into an error.
  await fs
    .rm(join(await gitDir(repo), 'leviathan-rebase'), { recursive: true, force: true, maxRetries: 3 })
    .catch(() => {})
}

/** Applies a commit, or several in the order given (git stops at one that does not apply cleanly). */
export async function cherryPick(repo: string, hashes: string | string[]): Promise<ChangesBlock | null> {
  const list = typeof hashes === 'string' ? [hashes] : hashes
  for (const hash of list) assertSafeArg(hash, 'commit')
  return unlessBlocked(repo, ['cherry-pick', ...list])
}

/** Reverts a commit, or several in the order given (newest first, so each one's changes are still there). */
export async function revert(repo: string, hashes: string | string[]): Promise<ChangesBlock | null> {
  const list = typeof hashes === 'string' ? [hashes] : hashes
  for (const hash of list) assertSafeArg(hash, 'commit')
  return unlessBlocked(repo, ['revert', '--no-edit', ...list])
}

// ---------------------------------------------------------------------------
// Bisect

/** Starts a bisect between `bad` (has the problem) and `good` (has not): git checks out a commit halfway to test. */
export async function bisectStart(repo: string, bad: string, good: string): Promise<ChangesBlock | null> {
  assertSafeArg(bad, 'commit')
  assertSafeArg(good, 'commit')
  // git would drop the one under way and start again.
  if (await currentBisect(repo)) throw new Error('A bisect is under way already: finish it first')
  // When the first checkout cannot be done, git undoes the start: it can simply start again.
  return unlessBlocked(repo, ['bisect', 'start', bad, good, '--'])
}

/**
 * Marks `hash` (the commit checked out when null) good, bad or skipped, and git checks out the next one to test.
 * When a change is in the way of that checkout, the mark is made all the same: marking it again only moves on.
 */
export async function bisectMark(repo: string, mark: BisectMark, hash: string | null): Promise<ChangesBlock | null> {
  if (!['good', 'bad', 'skip'].includes(mark)) throw new Error(`Invalid mark: ${mark}`)
  if (hash) assertSafeArg(hash, 'commit')
  // Only its words are needed, not the walk through history currentBisect makes.
  const dir = await gitDir(repo)
  if (!existsSync(join(dir, 'BISECT_START'))) throw new Error('No bisect under way')
  const terms = parseBisectTerms(await fs.readFile(join(dir, 'BISECT_TERMS'), 'utf8').catch(() => ''))
  const word = mark === 'skip' ? 'skip' : terms[mark]
  if (!/^[A-Za-z][\w-]*$/.test(word)) throw new Error(`Invalid bisect term: ${word}`)
  // Only skipped commits left: git says so with exit code 2, and the state tells as much.
  return unlessBlocked(repo, ['bisect', word, ...(hash ? [hash] : [])], { okCodes: [0, 2] })
}

/** Ends the bisect, back on the branch (or commit) it started from. */
export async function bisectReset(repo: string): Promise<ChangesBlock | null> {
  return unlessBlocked(repo, ['bisect', 'reset'])
}

export async function reset(repo: string, hash: string, mode: ResetMode): Promise<void> {
  assertSafeArg(hash, 'commit')
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw new Error(`Invalid reset mode: ${mode}`)
  await run(repo, ['reset', `--${mode}`, '-q', hash])
}

/** The file in git's `rebase-merge` folder that marks the rebase as a fixup's (`fixupCommit`): the fixup commit. */
export const FIXUP_MARK = 'leviathan-fixup'

/** The fixup commit of the rebase under way when it is a fixup's (`fixupCommit`), else null. */
async function stoppedFixup(repo: string): Promise<string | null> {
  const text = await fs.readFile(join(await gitDir(repo), 'rebase-merge', FIXUP_MARK), 'utf8').catch(() => null)
  return text?.trim() || null
}

export async function abortOperation(repo: string): Promise<void> {
  const op = await currentOperation(repo)
  if (!op) return
  // A fixup's rebase goes back to the commit made of the staged changes: they are staged again, as before it.
  const fixup = op === 'rebase' ? await stoppedFixup(repo) : null
  await run(repo, [op, '--abort'])
  await removeRebaseFiles(repo)
  if (fixup && (await run(repo, ['rev-parse', 'HEAD'])).trim() === fixup) {
    await run(repo, ['reset', '--soft', '-q', 'HEAD~1'])
  }
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

/** The files a stash changes, its untracked ones (kept in its third parent) too. */
export async function stashPaths(repo: string, index: number, hash: string): Promise<string[]> {
  const ref = await verifiedStashRef(repo, index, hash)
  const tracked = await run(repo, ['diff', '--name-only', '-z', '--no-renames', `${ref}^1`, ref])
  const untracked = await git(['ls-tree', '-r', '--name-only', '-z', `${ref}^3`], { cwd: repo, okCodes: [0, 128] })
  return [...new Set([...tracked.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean))]
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

export async function pull(repo: string, mode: PullMode, onProgress: ProgressFn): Promise<ChangesBlock | null> {
  const modeArgs = mode === 'rebase' ? ['--rebase'] : mode === 'ff-only' ? ['--ff-only'] : ['--no-rebase', '--ff']
  return unlessBlocked(repo, ['pull', '--progress', ...modeArgs], { onProgress })
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
 * Whether a branch of that name can be created: no branch is a folder above it
 * (`pr` for `pr/7`) or below it (`feature/old` for `feature`). A branch of that
 * very name does not count.
 */
async function branchNameFree(repo: string, name: string): Promise<boolean> {
  const parts = name.split('/')
  const above = parts.slice(1).map((_, i) => `refs/heads/${parts.slice(0, i + 1).join('/')}`)
  // A pattern matches the ref itself and everything below it.
  const refs = (await run(repo, ['for-each-ref', '--format=%(refname)', `refs/heads/${parts[0]}`])).split('\n')
  return !refs.some((r) => above.includes(r) || r.startsWith(`refs/heads/${name}/`))
}

/**
 * Checks out a pull request. A pull request whose branch lives in this
 * repository is checked out as that branch, tracking the remote one (and
 * fast-forwarded to it) — unless a local branch of that name is something else.
 * Otherwise (forks) the provider's `pull/N/head` (GitLab: `merge-requests/N/head`)
 * becomes a local `pr/N` branch (`pr-N` when a branch named `pr` exists).
 * Checking out again brings it up to date, also after the author rewrote it,
 * but never drops commits made on the local branch.
 */
export async function checkoutPullRequest(
  repo: string,
  remote: string,
  pr: { number: number; sourceBranch: string; fromFork: boolean },
  provider: Provider
): Promise<ChangesBlock | null> {
  assertSafeArg(remote, 'remote')
  if (!Number.isInteger(pr.number) || pr.number <= 0) throw new Error(`Invalid pull request number: ${pr.number}`)
  if (!pr.fromFork) {
    const branch = pr.sourceBranch
    assertSafeArg(branch, 'branch')
    const tracking = `refs/remotes/${remote}/${branch}`
    // `+` like git's default refspec: the remote-tracking branch follows force pushes.
    await git(['fetch', remote, `+refs/heads/${branch}:${tracking}`], { cwd: repo })
    const local = await refValue(repo, `refs/heads/${branch}`)
    if (!local && (await branchNameFree(repo, branch))) {
      return unlessBlocked(repo, ['checkout', '-q', '--track', `${remote}/${branch}`])
    }
    const follows =
      !!local &&
      (await configValue(repo, `branch.${branch}.remote`)) === remote &&
      (await configValue(repo, `branch.${branch}.merge`)) === `refs/heads/${branch}`
    if (local && follows) {
      const target = (await refValue(repo, tracking))!
      if (await isAncestor(repo, local, target)) await moveBranch(repo, branch, local, target)
      return unlessBlocked(repo, ['checkout', '-q', branch, '--'])
    }
    // A local branch with that name holds other work, or is in the way of it: leave it alone and use pr/N.
  }

  const branch = (await branchNameFree(repo, `pr/${pr.number}`)) ? `pr/${pr.number}` : `pr-${pr.number}`
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
  return unlessBlocked(repo, ['checkout', '-q', branch, '--'])
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

/** Files that differ between commit `from` and commit `to`, or the working tree (staged or not) when `to` is null. */
export async function compareFiles(repo: string, from: string, to: string | null): Promise<FileChange[]> {
  if (to) return getRangeFiles(repo, from, to)
  assertSafeArg(from, 'commit')
  const tracked = parseNameStatus(await run(repo, ['diff', '--name-status', '-z', '-M', from, '--']))
  // New files git does not track are part of the working tree too (ignored ones are not). A repository inside it is
  // listed as a folder (`inner/`): it has no contents to compare.
  const others = (await run(repo, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter((p) => p && !p.endsWith('/'))
  const known = new Set(tracked.map((f) => f.path))
  const untracked = others.filter((p) => !known.has(p)).map((path): FileChange => ({ path, status: '?' }))
  return [...tracked, ...untracked].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
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
  limit = HISTORY_PAGE,
  signal?: AbortSignal
): Promise<FileCommit[]> {
  insideRepo(repo, path)
  if (rev !== null) assertSafeArg(rev, 'commit')
  const count = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), HISTORY_MAX) : HISTORY_PAGE
  const out = await run(
    repo,
    ['log', '--follow', `-n${count}`, `--format=${HISTORY_FORMAT}`, '--name-status', ...(rev ? [rev] : []), '--', path],
    { env: LITERAL_PATHS, signal }
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
    // Names with quotes, backslashes or tabs come quoted, C-style.
    const [code, first, second] = change.split('\t').map((part, i) => (i ? unquotePath(part) : part))
    const status = code[0]
    if ((status === 'R' || status === 'C') && second) {
      history.push({ commit, path: second, oldPath: first, status })
    } else {
      history.push({ commit, path: first, status })
    }
    current = first
  }
  if (rev === null && !history.length) {
    // A rename staged but not committed yet: HEAD has the file under its old name.
    const staged = parseNameStatus(await run(repo, ['diff', '--cached', '--name-status', '-z', '-M', '--']))
    const renamed = staged.find((f) => f.status === 'R' && f.path === path.replace(/\\/g, '/'))
    if (renamed?.origPath) return getFileHistory(repo, renamed.origPath, null, limit)
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
  limit = HISTORY_PAGE,
  signal?: AbortSignal
): Promise<Commit[]> {
  const path = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  // The whole repository's history is the graph.
  if (!path || path === '.') throw new Error('Pick a folder of the repository')
  insideRepo(repo, path)
  if (rev !== null) assertSafeArg(rev, 'commit')
  const count = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), HISTORY_MAX) : HISTORY_PAGE
  const out = await run(repo, ['log', `-n${count}`, `--format=${LOG_FORMAT}`, ...(rev ? [rev] : []), '--', path], {
    env: LITERAL_PATHS,
    signal
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

/** The blame.ignoreRevsFile entries that exist (relative ones from the top of the repository, as git reads them). */
async function ignoreRevsFiles(repo: string): Promise<string[]> {
  const args = ['config', '--get-all', '--path', 'blame.ignoreRevsFile']
  const { stdout } = await git(args, { cwd: repo, okCodes: [0, 1] })
  const files = stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter(Boolean)
  const exists = await Promise.all(files.map((file) => fs.stat(resolve(repo, file)).then((s) => s.isFile(), noFile)))
  return files.filter((_, i) => exists[i])
}

const noFile = () => false

/**
 * Who last changed each line of a file: as it is in the working tree (`rev`
 * null; lines not committed yet have an all-zeros hash) or in a commit.
 */
export async function getBlame(
  repo: string,
  path: string,
  rev: string | null,
  signal?: AbortSignal
): Promise<BlameLine[]> {
  const full = insideRepo(repo, path)
  if (rev !== null) assertSafeArg(rev, 'commit')
  await assertBlameable(repo, full, path, rev)
  const blame = (ignore: string[]) =>
    run(repo, ['blame', '--porcelain', ...ignore, ...(rev ? [rev] : []), '--', path], { signal })
  const out = await blame([]).catch(async (err: unknown) => {
    // A blame.ignoreRevsFile this repository does not have (often set globally for the ones that do)
    // makes git refuse every blame: ask again with only the files that are there.
    if (!(err instanceof Error) || !/could not open object name list/.test(err.message)) throw err
    return blame(['--no-ignore-revs-file', ...(await ignoreRevsFiles(repo)).flatMap((f) => ['--ignore-revs-file', f])])
  })
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
    if (!remotes.length) throw new Error('This repository has no remotes. Add one first.')
    // The branch itself (is its upstream gone?) and the remote branches of its name.
    const lines = (
      await run(repo, [
        'for-each-ref',
        '--format=%(refname) %(upstream:track)',
        `refs/heads/${branch}`,
        ...remotes.map((r) => `refs/remotes/${r}/${branch}`)
      ])
    ).split('\n')
    const has = (r: string) => lines.some((l) => l.split(' ')[0] === `refs/remotes/${r}/${branch}`)
    const gone = lines.some((l) => l.startsWith(`refs/heads/${branch} `) && l.trim().endsWith('[gone]'))
    // A branch already published goes back where it is, even when it follows a branch of another remote.
    const published = [upstreamRemote, 'origin', ...remotes].find((r) => r && remotes.includes(r) && has(r))
    const preferred = upstreamRemote && remotes.includes(upstreamRemote) ? upstreamRemote : null
    const remote = opts.remote ?? published ?? preferred ?? (remotes.includes('origin') ? 'origin' : remotes[0])
    assertSafeArg(remote, 'remote')
    // Once the branch is published, an upstream with another name was set on purpose (`git branch -u
    // origin/develop`): keep it. A first publish tracks the new branch, as `git push -u` would.
    if (!upstreamRemote || !upstreamMerge || gone || !has(remote)) args.push('--set-upstream')
    args.push(remote, `refs/heads/${branch}:refs/heads/${branch}`)
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

/** Files larger than this get no copy for undo (a game's assets can be gigabytes): what changes them cannot be undone. */
export const UNDO_FILE_MAX = 50 * 1024 * 1024

async function stashList(repo: string): Promise<StashEntry[]> {
  const out = await run(repo, ['stash', 'list', '--format=%H%x1f%gs'])
  return out
    .split('\n')
    .map((line) => line.replace(/\r$/, '').split('\x1f'))
    .filter(([commit]) => commit)
    .map(([commit, message]) => ({ commit, message: message ?? '' }))
}

/** The index entries (not in conflict) of `paths`. */
async function indexEntries(repo: string, paths: string[]): Promise<Map<string, { mode: string; blob: string }>> {
  const entries = new Map<string, { mode: string; blob: string }>()
  // ls-files takes no pathspec file: a few hundred paths at a time keep its command line short enough for Windows.
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200)
    const out = await run(repo, ['ls-files', '-s', '-z', '--', ...chunk], { env: LITERAL_PATHS })
    for (const record of out.split('\0')) {
      const m = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(record)
      if (m && m[3] === '0') entries.set(m[4], { mode: m[1], blob: m[2] })
    }
  }
  return entries
}

/**
 * The bytes of `paths` in the working tree as blobs (`write`: kept in the repository's objects), exactly as they are:
 * no filters. Files over `maxBytes`, and symlinks, get none and are listed apart.
 */
async function worktreeBlobs(repo: string, paths: string[], write: boolean, maxBytes = Number.POSITIVE_INFINITY) {
  const blobs = new Map<string, string | null>()
  const skipped: string[] = []
  const present: string[] = []
  for (const path of paths) {
    const stat = await fs.lstat(insideRepo(repo, path)).catch(() => null)
    if (!stat || stat.isDirectory()) blobs.set(path, null)
    else if (!stat.isFile() || stat.size > maxBytes) skipped.push(path)
    else present.push(path)
  }
  if (present.length) {
    const args = ['hash-object', ...(write ? ['-w'] : []), '--no-filters', '--stdin-paths']
    const ids = (await run(repo, args, { input: present.join('\n') + '\n' })).split('\n').filter(Boolean)
    present.forEach((path, i) => blobs.set(path, ids[i]))
  }
  return { blobs, skipped }
}

async function fileVersions(repo: string, paths: string[], write: boolean, maxBytes?: number) {
  const [index, worktree] = await Promise.all([indexEntries(repo, paths), worktreeBlobs(repo, paths, write, maxBytes)])
  const versions: Record<string, FileVersion> = {}
  for (const path of paths) {
    if (!worktree.skipped.includes(path)) {
      versions[path] = { worktree: worktree.blobs.get(path) ?? null, index: index.get(path) ?? null }
    }
  }
  return { versions, skipped: worktree.skipped }
}

/**
 * Every local branch and tag (unpeeled, so annotated tags can be restored) plus HEAD and the stash list; and with
 * `paths`, a copy of those files (working tree and index), to bring them back.
 */
/** The paths of the uncommitted changes, staged or not, new files one by one (a rename's old name too). */
async function changedPaths(repo: string): Promise<string[]> {
  const { status } = parseStatus(
    await run(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  )
  const files = [...status.staged, ...status.unstaged]
  return [...new Set(files.flatMap((f) => (f.origPath ? [f.origPath, f.path] : [f.path])))]
}

/**
 * `which`: files to copy, or `'changes'` for every uncommitted change as git sees it now (a rename's old name too):
 * the app's last refresh may not have seen the latest ones yet.
 */
export async function getSnapshot(
  repo: string,
  which: string[] | 'changes' = [],
  maxBytes = UNDO_FILE_MAX
): Promise<Snapshot> {
  const paths = which === 'changes' ? await changedPaths(repo) : which
  const [out, head, config, stash, files, operation] = await Promise.all([
    run(repo, ['for-each-ref', '--format=%(refname)%1f%(objectname)', 'refs/heads', 'refs/tags']),
    currentHead(repo),
    branchConfig(repo),
    stashList(repo),
    paths.length ? fileVersions(repo, paths, true, maxBytes) : null,
    currentOperation(repo)
  ])
  const refs: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const [ref, hash] = line.replace(/\r$/, '').split('\x1f')
    if (ref && hash) refs[ref] = hash
  }
  const snapshot: Snapshot = { head, refs, config, stash, operation }
  if (files) snapshot.files = files.versions
  if (files?.skipped.length) snapshot.tooLarge = files.skipped
  return snapshot
}

function sameFile(a: FileVersion, b: FileVersion): boolean {
  return a.worktree === b.worktree && a.index?.mode === b.index?.mode && a.index?.blob === b.index?.blob
}

/** Puts files back as a change left them: their bytes in the working tree and their index entries. */
async function writeFiles(repo: string, moves: FileMove[]): Promise<void> {
  const entries: string[] = []
  for (const { path, from, to } of moves) {
    const full = insideRepo(repo, path)
    if (to.worktree !== from.worktree) {
      if (to.worktree === null) await fs.rm(full, { force: true })
      else {
        // The blob's bytes as they are, in a file of the repository's folder, then moved into place.
        const temp = (await run(repo, ['unpack-file', to.worktree])).trim()
        await fs.mkdir(dirname(full), { recursive: true })
        await fs.rename(join(repo, temp), full)
        if ((to.index ?? from.index)?.mode === '100755') await fs.chmod(full, 0o755)
      }
    }
    if (to.index?.mode !== from.index?.mode || to.index?.blob !== from.index?.blob) {
      const none = '0'.repeat((from.index ?? to.index)?.blob.length ?? 40)
      entries.push(to.index ? `${to.index.mode} ${to.index.blob}\t${path}` : `0 ${none}\t${path}`)
    }
  }
  if (entries.length) await run(repo, ['update-index', '-z', '--index-info'], { input: entries.join('\0') + '\0' })
}

/** Puts `paths` back as HEAD has them, in the index and the working tree; those HEAD has not are removed. */
async function filesToHead(repo: string, paths: string[]): Promise<void> {
  const ps = pathspecInput(paths)
  const inHead = new Set<string>()
  // A few hundred at a time, as for ls-files: the command line stays short enough for Windows.
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200)
    const out = await run(repo, ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...chunk], { env: LITERAL_PATHS })
    for (const path of out.split('\0')) if (path) inHead.add(path)
  }
  if (inHead.size) {
    const kept = pathspecInput([...inHead])
    await run(repo, ['checkout', '-q', 'HEAD', ...kept.args], kept.opts)
  }
  const added = paths.filter((p) => !inHead.has(p))
  if (added.length) {
    await run(repo, ['rm', '-q', '--cached', '--ignore-unmatch', ...ps.args], { ...ps.opts, input: added.join('\0') })
    for (const path of added) await fs.rm(insideRepo(repo, path), { force: true })
  }
}

/** Drops the stashes a change took away and stores again the ones it brought (they are kept as commits). */
async function moveStashes(repo: string, stash: RepoChange['stash']): Promise<void> {
  for (const gone of stash?.removed ?? []) {
    const index = (await stashList(repo)).findIndex((s) => s.commit === gone.commit)
    if (index >= 0) await run(repo, ['stash', 'drop', '-q', `stash@{${index}}`])
  }
  // Oldest first: the newest ends on top, as it was.
  for (const back of [...(stash?.added ?? [])].reverse()) {
    await run(repo, ['stash', 'store', '-m', back.message, back.commit])
  }
}

/**
 * Moves refs in one `update-ref --stdin` transaction: all of them or none, each only from where the change found it
 * (a ref another git holds, or one that moved meanwhile, stops them all).
 */
async function moveRefs(repo: string, moves: RefMove[]): Promise<void> {
  if (!moves.length) return
  const lines = moves.map((move) => {
    assertSafeArg(move.ref, 'ref')
    // A ref name has no spaces or line breaks; refuse a recorded one that would read as another command.
    if (/\s/.test(move.ref)) throw new Error(`Invalid ref: ${move.ref}`)
    if (move.to === null) return `delete ${move.ref}${move.from ? ` ${move.from}` : ''}`
    return move.from === null ? `create ${move.ref} ${move.to}` : `update ${move.ref} ${move.to} ${move.from}`
  })
  await run(repo, ['update-ref', '--stdin'], { input: lines.join('\n') + '\n' })
}

/** Puts back refs moved by `moveRefs` when what came after them failed: the change is then not applied at all. */
async function moveRefsBack(repo: string, moves: RefMove[]): Promise<void> {
  await moveRefs(
    repo,
    moves.map((m) => ({ ref: m.ref, from: m.to, to: m.from }))
  ).catch(() => {})
}

/** A branch that appears or disappears: its settings (upstream, ...) go with it. */
async function moveBranchConfig(repo: string, move: RefMove): Promise<void> {
  if (!move.ref.startsWith('refs/heads/') || (move.from !== null && move.to !== null)) return
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
  // Files edited since, or a stash list that moved on: their content would be lost.
  if (change.files?.length) {
    const now = await fileVersions(
      repo,
      change.files.map((f) => f.path),
      false
    )
    if (change.files.some((f) => !now.versions[f.path] || !sameFile(now.versions[f.path], f.from))) throw changed
  }
  if (change.stash) {
    const list = await stashList(repo)
    const has = (s: StashEntry) => list.some((e) => e.commit === s.commit)
    if (!change.stash.removed.every(has) || change.stash.added.some(has)) throw changed
  }

  // HEAD moves with files (a hard reset redone): `reset --keep` refuses their local changes, which are kept in the
  // change. They go back to HEAD first, and the files take the change's content after the move.
  const headMoves = from.branch !== change.head.to.branch || from.hash !== change.head.to.hash
  if (change.files?.length && headMoves && from.hash)
    await filesToHead(
      repo,
      change.files.map((f) => f.path)
    )
  await moveRefsAndHead(repo, change, concludesMerge)
  if (change.files?.length) await writeFiles(repo, change.files)
  if (change.stash) await moveStashes(repo, change.stash)
}

async function moveRefsAndHead(repo: string, change: RepoChange, concludesMerge: boolean): Promise<void> {
  const { from, to } = change.head
  const startRef = from.branch ? `refs/heads/${from.branch}` : null
  if (from.branch === to.branch) {
    // Undoing the first commit of a branch: it has no commit again, and what the commit had stays staged.
    const unborn = !!from.hash && !to.hash && change.mode === 'soft'
    if (change.refs.some((m) => m.ref === startRef && m.to === null) && !unborn) {
      throw new Error('The checked-out branch cannot be deleted')
    }
    const others = change.refs.filter((m) => m.ref !== startRef)
    const settle = async () => {
      for (const move of others) await moveBranchConfig(repo, move)
    }
    if (unborn) {
      await moveRefs(repo, [...others, { ref: startRef!, from: from.hash, to: null }])
      return settle()
    }
    if (to.hash && !from.hash && change.mode === 'soft') {
      // Redoing it: the branch is made again at the commit; the index already holds what it has.
      await moveRefs(repo, [...others, { ref: startRef ?? 'HEAD', from: null, to: to.hash }])
      return settle()
    }
    await moveRefs(repo, others)
    if (to.hash && to.hash !== from.hash) {
      try {
        if (concludesMerge) {
          // `reset --soft` refuses mid-merge; moving HEAD is all a soft reset does.
          await run(repo, ['update-ref', 'HEAD', to.hash, from.hash!])
          const dir = await gitDir(repo)
          await Promise.all(MERGE_STATE.map((f) => fs.rm(join(dir, f), { force: true })))
        } else {
          // `--keep` refuses local changes in its way, changing nothing.
          await run(repo, ['reset', '-q', `--${change.mode}`, to.hash])
        }
      } catch (err) {
        await moveRefsBack(repo, others)
        throw err
      }
    }
    await settle()
    if (change.mode === 'soft' && to.merge && !from.merge && from.hash) {
      // Undoing a merge commit: bring back the merge it concluded, ready to commit again.
      const message = await run(repo, ['log', '-1', '--format=%B', from.hash])
      const dir = await gitDir(repo)
      await fs.writeFile(join(dir, 'MERGE_HEAD'), to.merge.join('\n') + '\n')
      await fs.writeFile(join(dir, 'MERGE_MSG'), message)
      // A merge that could have fast-forwarded was made with --no-ff: without it, committing again would drop the
      // merge and keep only the other side.
      for (const head of to.merge) {
        if (to.hash && (await isAncestor(repo, to.hash, head))) {
          await fs.writeFile(join(dir, 'MERGE_MODE'), 'no-ff')
          break
        }
      }
    }
    return
  }

  // HEAD moves: create/move the target refs, switch, then update the branch we left and delete refs. When a step
  // fails, the ones before it are put back.
  const later = change.refs.filter((m) => m.ref === startRef || m.to === null)
  const early = change.refs.filter((m) => !later.includes(m))
  const checkout = (head: typeof to) =>
    head.branch
      ? run(repo, ['checkout', '-q', head.branch, '--'])
      : head.hash
        ? run(repo, ['checkout', '-q', '--detach', head.hash])
        : Promise.resolve('')
  await moveRefs(repo, early)
  try {
    await checkout(to)
  } catch (err) {
    await moveRefsBack(repo, early)
    throw err
  }
  try {
    await moveRefs(repo, later)
  } catch (err) {
    await checkout(from).catch(() => {})
    await moveRefsBack(repo, early)
    throw err
  }
  for (const move of change.refs) await moveBranchConfig(repo, move)
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
  const stat = await fs.lstat(full).catch((err: NodeJS.ErrnoException) => {
    // Deleted on both sides (or by hand): nothing to read, the conflict is still there.
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (!stat) return { text: null, reason: 'missing' }
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
