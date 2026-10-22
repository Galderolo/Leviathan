import type { RepoChange } from '../../shared/undo'

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
