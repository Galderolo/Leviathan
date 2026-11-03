import { isAbsolute, resolve } from 'node:path'
import { parseWorktrees, type Worktree } from '../../shared/worktrees'
import { git } from './runner'
import { samePath } from './submodules'

async function run(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  return (await git(args, { cwd, env })).stdout
}

function assertName(value: string, what: string): void {
  if (!value || value.startsWith('-')) throw new Error(`Invalid ${what}: "${value}"`)
}

/** The repository's worktrees, the main one first, the one `repo` is open from marked. */
export async function getWorktrees(repo: string): Promise<Worktree[]> {
  const list = parseWorktrees(await run(repo, ['worktree', 'list', '--porcelain']))
  return list.map((w) => ({ ...w, current: samePath(w.path, repo) }))
}

/**
 * Checks `branch` out in a new worktree at `folder` (a full path, created by git). A remote branch gets a local one
 * following it, unless one of that name exists. Gives the folder's path.
 */
export async function addWorktree(repo: string, folder: string, branch: string, remote = false): Promise<string> {
  if (!isAbsolute(folder)) throw new Error(`Not a full path: "${folder}"`)
  assertName(branch, 'branch')
  const path = resolve(folder)
  if (!remote) {
    await run(repo, ['worktree', 'add', path, branch])
    return path
  }
  const remotes = (await run(repo, ['remote']))
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
  const name = remotes.sort((a, b) => b.length - a.length).find((r) => branch.startsWith(r + '/'))
  const local = name ? branch.slice(name.length + 1) : branch
  const { exitCode } = await git(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], {
    cwd: repo,
    okCodes: [0, 1]
  })
  if (exitCode === 0) await run(repo, ['worktree', 'add', path, local])
  else await run(repo, ['worktree', 'add', '--track', '-b', local, path, branch])
  return path
}

/**
 * Removes a worktree and its folder. Git refuses one with changes (its message names `--force`) unless `force`; the
 * folder the repository is open from is never removed.
 */
export async function removeWorktree(repo: string, folder: string, force: boolean): Promise<void> {
  if (!isAbsolute(folder)) throw new Error(`Not a full path: "${folder}"`)
  if (samePath(folder, repo)) throw new Error('This is the folder the repository is open from.')
  // In English: the app recognises git's "use --force" to offer it.
  await run(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), resolve(folder)], {
    LC_ALL: 'C',
    LANGUAGE: 'C'
  })
}

/** Forgets the worktrees whose folder was deleted by hand. */
export async function pruneWorktrees(repo: string): Promise<void> {
  await run(repo, ['worktree', 'prune'])
}
