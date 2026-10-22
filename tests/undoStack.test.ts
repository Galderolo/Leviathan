import { describe, expect, it } from 'vitest'
import {
  MAX_UNDO,
  isStaleUndoError,
  staleHistoryKey,
  popRedo,
  popUndo,
  pushEntry,
  undoModeForReset,
  type Stacks,
  type UndoEntry
} from '../src/renderer/src/undoStack'

const entry = (label: string): UndoEntry => ({
  label,
  change: { refs: [], head: { from: { branch: 'a', hash: '1' }, to: { branch: 'b', hash: '2' } }, mode: 'keep' }
})
const empty: Stacks = { undo: [], redo: [] }

describe('undo stacks', () => {
  it('pushing a new action clears redo', () => {
    const stacks = pushEntry({ undo: [entry('one')], redo: [entry('old')] }, entry('two'))
    expect(stacks.undo.map((e) => e.label)).toEqual(['one', 'two'])
    expect(stacks.redo).toEqual([])
  })

  it('undo moves the latest entry to redo, and redo moves it back', () => {
    const start = pushEntry(pushEntry(empty, entry('one')), entry('two'))
    const undone = popUndo(start)!
    expect(undone.entry.label).toBe('two')
    expect(undone.stacks.undo.map((e) => e.label)).toEqual(['one'])
    expect(undone.stacks.redo.map((e) => e.label)).toEqual(['two'])

    const redone = popRedo(undone.stacks)!
    expect(redone.entry.label).toBe('two')
    expect(redone.stacks).toEqual(start)
  })

  it('returns null when there is nothing to undo or redo', () => {
    expect(popUndo(empty)).toBeNull()
    expect(popRedo(empty)).toBeNull()
  })

  it(`keeps at most ${MAX_UNDO} entries`, () => {
    let stacks = empty
    for (let i = 0; i < MAX_UNDO + 5; i++) stacks = pushEntry(stacks, entry(String(i)))
    expect(stacks.undo).toHaveLength(MAX_UNDO)
    expect(stacks.undo[0].label).toBe('5')
  })
})

describe('undo helpers', () => {
  it('records each reset with the mode that can reverse it', () => {
    expect(undoModeForReset('soft')).toBe('soft')
    expect(undoModeForReset('mixed')).toBe('mixed')
    expect(undoModeForReset('hard')).toBe('keep')
  })

  it('drops an entry only when the repository moved on', () => {
    expect(isStaleUndoError('The repository changed since this action, so it can no longer be undone.')).toBe(true)
    expect(isStaleUndoError('Finish or abort the merge in progress first.')).toBe(false)
    expect(isStaleUndoError("error: Entry 'a.txt' not uptodate. Cannot merge.")).toBe(false)
  })
})

describe('staleHistoryKey', () => {
  it('names the direction that can no longer be applied', () => {
    expect(staleHistoryKey('undo')).toBe('toast.undoStale')
    expect(staleHistoryKey('redo')).toBe('toast.redoStale')
  })
})
