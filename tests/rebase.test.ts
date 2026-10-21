import { describe, expect, it } from 'vitest'
import { planRebase, rebaseProblem, shQuote, type RebaseItem } from '../src/shared/rebase'

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

describe('planRebase', () => {
  const original: Record<string, string> = { a1: 'A', b2: 'B', c3: 'C', d4: 'D', e5: 'E', f6: 'F' }
  const plan = (items: RebaseItem[]) =>
    planRebase(
      items,
      (hash) => original[hash],
      (name) => `/git/${name}`
    )

  it('keeps plain picks, fixups and drops as they are', () => {
    expect(plan([item('a1', 'pick'), item('b2', 'fixup'), item('c3', 'drop')])).toEqual({
      todo: 'pick a1\nfixup b2\ndrop c3\n',
      files: {}
    })
  })

  it('sets a group message with one amend, only if its own commit was made', () => {
    const { todo, files } = plan([
      item('a1', 'reword', 'New A'),
      item('b2', 'squash'),
      item('c3', 'drop'),
      item('d4', 'fixup'),
      item('e5', 'pick'),
      item('f6', 'squash')
    ])
    const guard = (i: number) =>
      `exec if [ "$(cat '/git/after-${i}')" != "$(cat '/git/before-${i}')" ]; then ` +
      `git commit --amend --allow-empty --no-verify -q --cleanup=whitespace -F '/git/msg-${i}'; fi`
    expect(todo.split('\n')).toEqual([
      "exec git rev-parse HEAD > '/git/before-0'",
      'pick a1',
      "exec git rev-parse HEAD > '/git/after-0'",
      'fixup b2',
      'drop c3',
      'fixup d4',
      guard(0),
      "exec git rev-parse HEAD > '/git/before-4'",
      'pick e5',
      "exec git rev-parse HEAD > '/git/after-4'",
      'fixup f6',
      guard(4),
      ''
    ])
    expect(files).toEqual({ 'msg-0': 'New A\n\nB', 'msg-4': 'E\n\nF' })
  })
})

describe('shQuote', () => {
  it('quotes for sh, including single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
    expect(shQuote('C:/My Repo/x')).toBe("'C:/My Repo/x'")
  })
})
