import { describe, expect, it } from 'vitest'
import {
  MAX_UNDO,
  isStaleUndoError,
  staleHistoryKey,
  popRedo,
  popUndo,
  pushEntry,
  leftUnderWay,
  settleStopped,
  undoModeForReset,
  type Stacks,
  type UndoEntry
} from '../src/renderer/src/undoStack'

const entry = (label: string): UndoEntry => ({
  label,
  change: { refs: [], head: { from: { branch: 'a', hash: '1' }, to: { branch: 'b', hash: '2' } }, mode: 'keep' }
})
const empty: Stacks = { undo: [], redo: [] }

describe('an action that stopped part way', () => {
  it('waits for the rebase, cherry-pick or revert it left under way, not for a merge', () => {
    expect(leftUnderWay(null, 'rebase')).toBe(true)
    expect(leftUnderWay(null, 'cherry-pick')).toBe(true)
    expect(leftUnderWay(null, 'revert')).toBe(true)
    // The commit that concludes a merge is recorded, and undoing it brings the merge back with what was resolved.
    expect(leftUnderWay(null, 'merge')).toBe(false)
    expect(leftUnderWay(null, null)).toBe(false)
    // One already under way before the action is not its own.
    expect(leftUnderWay('rebase', 'rebase')).toBe(false)
  })

  it('is recorded once over, in place of what was recorded while it was under way', () => {
    const before = entry('commit')
    const rebase = entry('rebase')
    const stacks: Stacks = { undo: [before, entry('amend while stopped')], redo: [] }
    expect(settleStopped(stacks, { label: 'rebase', since: before }, rebase.change)).toEqual({
      undo: [before, { label: 'rebase', change: rebase.change }],
      redo: []
    })
    // It started with nothing to undo.
    expect(
      settleStopped({ undo: [entry('amend')], redo: [] }, { label: 'rebase', since: null }, rebase.change)
    ).toEqual({ undo: [{ label: 'rebase', change: rebase.change }], redo: [] })
  })

  it('records nothing once aborted, and drops what was recorded while it was under way', () => {
    const before = entry('commit')
    const stacks: Stacks = { undo: [before, entry('amend while stopped')], redo: [entry('redo')] }
    expect(settleStopped(stacks, { label: 'rebase', since: before }, null)).toEqual({
      undo: [before],
      redo: [entry('redo')]
    })
  })

  it('keeps the entries when the one it started after is no longer there (the oldest go past the limit)', () => {
    const stacks: Stacks = { undo: [entry('a'), entry('b')], redo: [] }
    const settled = settleStopped(stacks, { label: 'rebase', since: entry('gone') }, entry('rebase').change)
    expect(settled.undo.map((e) => e.label)).toEqual(['a', 'b', 'rebase'])
  })
})

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
