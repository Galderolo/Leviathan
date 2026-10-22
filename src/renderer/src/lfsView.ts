import type { LfsLock, LfsPattern } from '../../shared/lfs'
import type { RepoState } from '../../shared/types'

function isAttributesFile(path: string): boolean {
  return path === '.gitattributes' || path.endsWith('/.gitattributes')
}

function changedFiles(state: RepoState) {
  return [...state.status.staged, ...state.status.unstaged, ...state.status.conflicted]
}

/** Changes when the LFS patterns may have changed: another commit checked out, or an attributes file changed. */
export function lfsInfoKey(state: RepoState): string {
  const attributes = changedFiles(state)
    .filter((f) => isAttributesFile(f.path))
    .map((f) => `${f.status}:${f.path}`)
  return [state.head.hash ?? '', ...attributes].join('\n')
}

/** An attributes file has uncommitted changes, which may have been edited again since the last look. */
export function attributesChanged(state: RepoState): boolean {
  return changedFiles(state).some((f) => isAttributesFile(f.path))
}

export function lockFor(locks: LfsLock[] | undefined, path: string): LfsLock | null {
  return locks?.find((l) => l.path === path) ?? null
}

/** Locks someone else holds on these files: pushing changes to them will be refused. */
export function lockedByOthers(locks: LfsLock[], paths: string[]): LfsLock[] {
  const wanted = new Set(paths)
  return locks.filter((l) => l.mine === false && wanted.has(l.path))
}

/** A pattern as it applies in the repository: with the folder of the attributes file it comes from. */
export function patternLabel(pattern: LfsPattern): string {
  const dir = pattern.source.slice(0, -'.gitattributes'.length)
  return dir + pattern.pattern
}

export function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${Math.round(gb * 10) / 10} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${Math.round(bytes / 1024)} KB`
}
