import { describe, expect, it } from 'vitest'
import { pairChanges, splitRows, tokenize, wordDiff } from '../src/shared/wordDiff'
import type { DiffLine } from '../src/shared/types'

const del = (text: string): DiffLine => ({ type: 'del', text })
const add = (text: string): DiffLine => ({ type: 'add', text })
const ctx = (text: string): DiffLine => ({ type: 'ctx', text })
const changed = (spans: { text: string; changed: boolean }[]) => spans.filter((s) => s.changed).map((s) => s.text)

describe('tokenize', () => {
  it('splits words (any alphabet), spaces and punctuation', () => {
    expect(tokenize('const año = f(x, 42);')).toEqual([
      'const',
      ' ',
      'año',
      ' ',
      '=',
      ' ',
      'f',
      '(',
      'x',
      ',',
      ' ',
      '42',
      ')',
      ';'
    ])
  })
})

describe('wordDiff', () => {
  it('marks only the words that changed, on each side', () => {
    const diff = wordDiff('const total = price * 2', 'const total = price * qty')!
    expect(changed(diff.old)).toEqual(['2'])
    expect(changed(diff.new)).toEqual(['qty'])
    expect(diff.old.map((s) => s.text).join('')).toBe('const total = price * 2')
    expect(diff.new.map((s) => s.text).join('')).toBe('const total = price * qty')
  })

  it('merges neighbouring changed words into one span', () => {
    const diff = wordDiff('return a + b', 'return x - y')!
    expect(changed(diff.new)).toEqual(['x - y'])
  })

  it('gives up on lines that have almost nothing in common', () => {
    expect(wordDiff('import fs from "fs"', 'return items.length > 0')).toBeNull()
  })

  it('gives up on huge lines instead of slowing down', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(' ')
    expect(wordDiff(long, long + ' x')).toBeNull()
  })
})

describe('pairChanges', () => {
  it('pairs each deleted line with the added line in the same position of the change', () => {
    const lines = [ctx('a'), del('b'), del('c'), add('B'), add('C'), add('D'), ctx('e')]
    expect([...pairChanges(lines)]).toEqual([
      [1, 3],
      [3, 1],
      [2, 4],
      [4, 2]
    ])
  })
})

describe('splitRows', () => {
  it('lines up old and new side by side', () => {
    const lines = [ctx('a'), del('b'), add('B'), add('C'), ctx('d'), add('E')]
    expect(splitRows(lines)).toEqual([
      { left: 0, right: 0 },
      { left: 1, right: 2 },
      { left: null, right: 3 },
      { left: 4, right: 4 },
      { left: null, right: 5 }
    ])
  })

  it('keeps "no newline" notes on the side they belong to', () => {
    const lines: DiffLine[] = [del('a'), { type: 'meta', text: '\\ No newline at end of file' }, add('a2')]
    expect(splitRows(lines)).toEqual([
      { left: 0, right: 2 },
      { left: 1, right: null }
    ])
  })
})
