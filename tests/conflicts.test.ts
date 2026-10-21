import { describe, expect, it } from 'vitest'
import { conflictCount, parseConflicts, resolveConflicts } from '../src/shared/conflicts'

const SIMPLE = ['top\n', '<<<<<<< HEAD\n', 'mine\n', '=======\n', 'theirs\n', '>>>>>>> feature\n', 'bottom\n'].join('')

describe('parseConflicts', () => {
  it('splits common text and conflict blocks with their labels', () => {
    expect(parseConflicts(SIMPLE)).toEqual([
      { kind: 'common', lines: ['top\n'] },
      {
        kind: 'conflict',
        ours: ['mine\n'],
        base: null,
        theirs: ['theirs\n'],
        oursLabel: 'HEAD',
        theirsLabel: 'feature'
      },
      { kind: 'common', lines: ['bottom\n'] }
    ])
  })

  it('reads the base of diff3-style markers', () => {
    const text = '<<<<<<< HEAD\na\n||||||| base\no\n=======\nb\n>>>>>>> x\n'
    const [block] = parseConflicts(text)
    expect(block).toMatchObject({ kind: 'conflict', ours: ['a\n'], base: ['o\n'], theirs: ['b\n'] })
    expect(resolveConflicts(parseConflicts(text), ['ours'])).toBe('a\n')
  })

  it('keeps a separator-looking line outside conflicts as common text', () => {
    const text = 'Title\n=======\n'
    expect(parseConflicts(text)).toEqual([{ kind: 'common', lines: ['Title\n', '=======\n'] }])
    expect(conflictCount(parseConflicts(text))).toBe(0)
  })
})

describe('resolveConflicts', () => {
  it('builds the result from each choice', () => {
    const two = SIMPLE + '<<<<<<< HEAD\nm2\n=======\nt2\n>>>>>>> feature\n'
    const segments = parseConflicts(two)
    expect(conflictCount(segments)).toBe(2)
    expect(resolveConflicts(segments, ['ours', 'theirs'])).toBe('top\nmine\nbottom\nt2\n')
    expect(resolveConflicts(segments, ['ours-theirs', 'theirs-ours'])).toBe('top\nmine\ntheirs\nbottom\nt2\nm2\n')
  })

  it('keeps CRLF line endings', () => {
    const text = 'a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> b\r\nz\r\n'
    expect(resolveConflicts(parseConflicts(text), ['theirs'])).toBe('a\r\ny\r\nz\r\n')
  })

  it('keeps a missing final newline', () => {
    const text = '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\nend'
    expect(resolveConflicts(parseConflicts(text), ['ours'])).toBe('x\nend')
  })

  it('returns null while a conflict is unresolved', () => {
    expect(resolveConflicts(parseConflicts(SIMPLE), [null])).toBeNull()
  })
})
