import type { RepoOperation } from '../../shared/types'
import type { RepoChange, Snapshot } from '../../shared/undo'

export interface UndoEntry {
  /** Human-readable action, e.g. `commit "Fix login"`. */
  label: string
  /** The change as it happened (apply it to redo, invert it to undo). */
  change: RepoChange
}

export interface Stacks {
  undo: UndoEntry[]
  redo: UndoEntry[]
}

/** An action that stopped part way, to be recorded once it is over (`settleStopped`). */
export interface StoppedAction {
  label: string
  mode: RepoChange['mode']
  /** The repository before it, with copies of `paths`. */
  before: Snapshot
  paths: string[]
  /** The entry on top of the undo stack when it stopped. */
  since: UndoEntry | null
  /** false: the stash list is left out of what is recorded (`leavingStashes`). */
  stashes?: boolean
}

export const MAX_UNDO = 50

/** Records a new action; anything that was undone can no longer be redone. */
export function pushEntry(stacks: Stacks, entry: UndoEntry): Stacks {
  return { undo: [...stacks.undo, entry].slice(-MAX_UNDO), redo: [] }
}

export function popUndo(stacks: Stacks): { stacks: Stacks; entry: UndoEntry } | null {
  const entry = stacks.undo[stacks.undo.length - 1]
  if (!entry) return null
  return { entry, stacks: { undo: stacks.undo.slice(0, -1), redo: [...stacks.redo, entry] } }
}

export function popRedo(stacks: Stacks): { stacks: Stacks; entry: UndoEntry } | null {
  const entry = stacks.redo[stacks.redo.length - 1]
  if (!entry) return null
  return { entry, stacks: { undo: [...stacks.undo, entry], redo: stacks.redo.slice(0, -1) } }
}

/**
 * Whether an action left a rebase, cherry-pick or revert under way (stopped for conflicts, or at a commit to edit):
 * it is recorded once that is over. A merge is not waited for: the commit that concludes it is recorded, and undoing
 * that commit brings the merge back with what was resolved.
 */
export function leftUnderWay(before: RepoOperation, after: RepoOperation): boolean {
  return !before && !!after && after !== 'merge'
}

/**
 * The stacks once an action that stopped part way is over: its change (null when it was aborted, or changed nothing)
 * takes the place of what was recorded while it was under way (an amend at a commit to edit, the commit that ended a
 * cherry-pick), which it holds. `since` is the entry that was on top when it stopped.
 */
export function settleStopped(
  stacks: Stacks,
  stopped: { label: string; since: UndoEntry | null },
  change: RepoChange | null
): Stacks {
  const at = stopped.since ? stacks.undo.lastIndexOf(stopped.since) + 1 : 0
  // Not there any more (past the limit): what came after it cannot be told apart, so it all stays.
  const kept = stopped.since && at === 0 ? stacks : { undo: stacks.undo.slice(0, at), redo: stacks.redo }
  return change ? pushEntry(kept, { label: stopped.label, change }) : kept
}

/** How to move the branch back and forth so the index and files end up as the reset left them. */
export function undoModeForReset(mode: 'soft' | 'mixed' | 'hard'): RepoChange['mode'] {
  return mode === 'hard' ? 'keep' : mode
}

/** True when an entry failed because the repository moved on, so it can never apply again. */
export function isStaleUndoError(message: string): boolean {
  return /can no longer be undone/.test(message)
}

/** Message for an entry that can no longer be applied, in the direction it was tried. */
export function staleHistoryKey(direction: 'undo' | 'redo'): 'toast.undoStale' | 'toast.redoStale' {
  return direction === 'undo' ? 'toast.undoStale' : 'toast.redoStale'
}
