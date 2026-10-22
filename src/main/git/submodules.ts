import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseGitlinks, parseSubmoduleConfig } from '../../shared/submodules'
import type { Submodule } from '../../shared/types'
import { insideRepo, type ProgressFn } from './repository'
import { git, type RunOptions } from './runner'

const LITERAL = { GIT_LITERAL_PATHSPECS: '1' }

async function run(cwd: string, args: string[], extra: Partial<RunOptions> = {}): Promise<string> {
  return (await git(args, { cwd, ...extra })).stdout
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const full = resolve(p)
    return process.platform === 'win32' ? full.toLowerCase() : full
  }
  return norm(a) === norm(b)
}

/** The commit checked out in a submodule, or null when it is not initialized (its folder empty or missing). */
async function checkedOut(repo: string, path: string): Promise<string | null> {
  const dir = insideRepo(repo, path)
  // Without its own `.git`, git would answer for the parent repository.
  if (!existsSync(join(dir, '.git'))) return null
  try {
    const [top, head] = (await run(dir, ['rev-parse', '--show-toplevel', 'HEAD'])).trim().split('\n')
    return samePath(top, dir) ? head : null
  } catch {
    return null
  }
}

/** Submodules with changes inside them (tracked files), from the parent's status. */
async function dirtyPaths(repo: string, paths: string[]): Promise<Set<string>> {
  const out = await run(
    repo,
    ['status', '--porcelain=v2', '-z', '--untracked-files=no', '--ignore-submodules=none', '--', ...paths],
    { env: LITERAL }
  )
  const dirty = new Set<string>()
  for (const entry of out.split('\0')) {
    // `1 XY Scmu mH mI mW hH hI path`; unmerged `u XY Scmu m1 m2 m3 mW h1 h2 h3 path`
    const fields = entry.split(' ')
    const before = entry.startsWith('1 ') ? 8 : entry.startsWith('u ') ? 10 : -1
    if (before < 0 || fields[2]?.[0] !== 'S' || fields[2][2] !== 'M') continue
    dirty.add(fields.slice(before).join(' '))
  }
  return dirty
}

/** The repository's submodules and their state. Nothing to do (and no git run) without a `.gitmodules`. */
export async function getSubmodules(repo: string): Promise<Submodule[]> {
  if (!existsSync(join(repo, '.gitmodules'))) return []
  const config = await git(['config', '-z', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url)$'], {
    cwd: repo,
    okCodes: [0, 1]
  })
  const declared = parseSubmoduleConfig(config.stdout)
  if (!declared.length) return []
  const paths = declared.map((s) => s.path)
  const [links, dirty] = await Promise.all([
    run(repo, ['ls-files', '-s', '-z', '--', ...paths], { env: LITERAL }).then(parseGitlinks),
    dirtyPaths(repo, paths)
  ])
  return Promise.all(
    declared
      .filter((s) => links.has(s.path))
      .map(async (s): Promise<Submodule> => {
        const link = links.get(s.path)!
        const current = await checkedOut(repo, s.path)
        const state = link.conflict
          ? 'conflict'
          : current === null
            ? 'uninitialized'
            : current === link.hash
              ? 'clean'
              : 'outOfSync'
        return { ...s, recorded: link.hash, current, state, dirty: dirty.has(s.path) }
      })
  )
}

/**
 * Initializes and checks out submodules at the commits the repository records (`paths`, or all of them), and theirs
 * in turn. Git refuses where that would overwrite changes made inside a submodule.
 */
export async function updateSubmodules(repo: string, paths: string[] | null, onProgress: ProgressFn): Promise<void> {
  if (paths) {
    const known = new Set((await getSubmodules(repo)).map((s) => s.path))
    for (const p of paths) if (!known.has(p)) throw new Error(`Not a submodule: ${p}`)
  }
  await run(repo, ['submodule', 'update', '--init', '--recursive', '--progress', '--', ...(paths ?? [])], {
    onProgress
  })
}
