import { describe, expect, it } from 'vitest'
import { buildTodo, rebaseProblem, shQuote, type RebaseItem } from '../src/shared/rebase'

const item = (hash: string, action: RebaseItem['action'], message?: string): RebaseItem => ({ hash, action, message })

describe('rebaseProblem', () => {
  it('accepts a valid list', () => {
    expect(rebaseProblem([item('a', 'pick'), item('b', 'squash'), item('c', 'reword', 'New')])).toBeNull()
  })

  it('refuses dropping every commit', () => {
    expect(rebaseProblem([item('a', 'drop'), item('b', 'drop')])).toBe('empty')
  })

  it('refuses melding the oldest remaining commit into nothing', () => {
    expect(rebaseProblem([item('a', 'fixup'), item('b', 'pick')])).toBe('noBase')
    expect(rebaseProblem([item('a', 'drop'), item('b', 'squash')])).toBe('noBase')
  })

  it('refuses a reword without a message', () => {
    expect(rebaseProblem([item('a', 'reword', '  \n')])).toBe('noMessage')
    expect(rebaseProblem([item('a', 'reword')])).toBe('noMessage')
  })
})

describe('buildTodo', () => {
  it('writes one line per commit and an exec amend after each reword', () => {
    const todo = buildTodo(
      [item('a1', 'pick'), item('b2', 'reword', 'B'), item('c3', 'squash'), item('d4', 'fixup'), item('e5', 'drop')],
      (i) => `/git/msg-${i}`
    )
    expect(todo).toBe(
      [
        'pick a1',
        'pick b2',
        "exec git commit --amend --allow-empty --no-verify -q -F '/git/msg-1'",
        'squash c3',
        'fixup d4',
        'drop e5',
        ''
      ].join('\n')
    )
  })
})

describe('shQuote', () => {
  it('quotes for sh, including single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
    expect(shQuote('C:/My Repo/x')).toBe("'C:/My Repo/x'")
  })
})
