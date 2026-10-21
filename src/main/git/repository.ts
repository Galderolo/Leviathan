import { existsSync, promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  LOG_FORMAT,
  REF_FORMAT,
  STASH_FORMAT,
  contentDiff,
  parseDiff,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashes,
  parseStatus,
  untrackedDiff
} from '../../shared/parsers'
import type {
  Commit,
  CommitDetails,
  DiffSource,
  FileDiff,
  PullMode,
  RepoOperation,
  RepoState,
  ResetMode
} from '../../shared/types'
import type { BranchConfig, HeadState, RefMove, RepoChange, Snapshot } from '../../shared/undo'
import { GitError, NON_INTERACTIVE_ENV, git } from './runner'

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

export async function getState(repo: string): Promise<RepoState> {
  const [statusOut, remotesOut, refsOut, stashOut, operation] = await Promise.all([
    run(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
    run(repo, ['remote', '-v']),
    // `upstream:track` is localised; force the C locale so it can be parsed.
    run(repo, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'], {
      env: { LC_ALL: 'C' }
    }),
    run(repo, ['stash', 'list', `--format=${STASH_FORMAT}`]),
    currentOperation(repo)
  ])
  const remotes = parseRemotes(remotesOut)
  const { head, status } = parseStatus(statusOut)
  return {
    path: repo,
    head,
    refs: parseRefs(
      refsOut,
      remotes.map((r) => r.name)
    ),
    stashes: parseStashes(stashOut),
    remotes,
    status,
    operation
  }
}

export async function getLog(repo: string, limit: number): Promise<{ commits: Commit[]; hasMore: boolean }> {
  // Decide what to log up front instead of parsing (localised) error messages:
  // HEAD may be unborn (new repo, orphan branch) while other branches exist.
  const revs = ['--branches', '--remotes', '--tags']
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
  const out = await run(repo, [
    'log',
    '--date-order',
    `--max-count=${limit + 1}`,
    `--format=${LOG_FORMAT}`,
    ...revs,
    '--'
  ])
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
  return { commit, message: message.trimEnd(), files: parseNameStatus(filesOut) }
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

export async function getDiff(repo: string, source: DiffSource): Promise<FileDiff> {
  const diffArgs = ['--no-ext-diff', '-M']
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
      const out = source.parent
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
}

export async function continueOperation(repo: string): Promise<void> {
  const op = await currentOperation(repo)
  if (op === 'merge') await run(repo, ['commit', '--no-edit'])
  else if (op) await run(repo, [op, '--continue'])
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

export async function stashSave(repo: string, message: string | null): Promise<void> {
  const args = ['stash', 'push', '--include-untracked']
  if (message && message.trim()) args.push('-m', message.trim())
  await run(repo, args)
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

/** Raw content of a working-tree file (null for binary files), for the conflict editor. */
export async function readWorkingFile(repo: string, path: string): Promise<{ text: string | null; binary: boolean }> {
  const { binary, content } = await readPreview(repo, path)
  return binary ? { text: null, binary: true } : { text: content, binary: false }
}

/** Writes the resolved content and marks the file resolved. */
export async function resolveConflictFile(repo: string, path: string, content: string): Promise<void> {
  await fs.writeFile(insideRepo(repo, path), content, 'utf8')
  await run(repo, ['add', '--', path], { env: LITERAL_PATHS })
}

/**
 * Resolves a conflict with one side of the whole file. When that side deleted
 * the file (no index stage for it), the deletion is taken.
 */
export async function resolveConflictWith(repo: string, path: string, side: 'ours' | 'theirs'): Promise<void> {
  insideRepo(repo, path)
  const stages = await run(repo, ['ls-files', '-u', '-z', '--', path], { env: LITERAL_PATHS })
  const wanted = side === 'ours' ? '2' : '3'
  const present = stages.split('\0').some((entry) => entry.split(/\s+/)[2] === wanted)
  if (present) {
    await run(repo, ['checkout', `--${side}`, '--', path], { env: LITERAL_PATHS })
    await run(repo, ['add', '--', path], { env: LITERAL_PATHS })
  } else {
    await run(repo, ['rm', '-q', '--', path], { env: LITERAL_PATHS })
  }
}
