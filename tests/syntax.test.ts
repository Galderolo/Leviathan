import { describe, expect, it } from 'vitest'
import { htmlToLines, languageFor, mergeSegments } from '../src/shared/syntax'
import { highlightHunk } from '../src/renderer/src/syntax'
import type { DiffHunk, DiffLine } from '../src/shared/types'

describe('languageFor', () => {
  it('picks the language from the file name, including the files of a Unity project', () => {
    expect(languageFor('Assets/Scripts/Player.cs')).toBe('csharp')
    expect(languageFor('web/App.TSX')).toBe('typescript')
    expect(languageFor('Assets/Shaders/Water.shader')).toBe('glsl')
    expect(languageFor('Assets/Prefabs/Hero.prefab')).toBe('yaml')
    expect(languageFor('UI/Main.uss')).toBe('css')
    expect(languageFor('UI/Main.uxml')).toBe('xml')
    expect(languageFor('docker/Dockerfile')).toBe('dockerfile')
    expect(languageFor('Makefile')).toBe('makefile')
    expect(languageFor('notes.unknownext')).toBeNull()
    expect(languageFor('LICENSE')).toBeNull()
  })
})

describe('htmlToLines', () => {
  it('splits highlight.js output into lines of classed text, carrying a token across line breaks', () => {
    const html =
      '<span class="hljs-comment">/* a\nb */</span>\nx &lt; <span class="hljs-number">1</span> &amp;&amp; &quot;&#x27;'
    expect(htmlToLines(html)).toEqual([
      [{ text: '/* a', cls: 'hljs-comment' }],
      [{ text: 'b */', cls: 'hljs-comment' }],
      [
        { text: 'x < ', cls: '' },
        { text: '1', cls: 'hljs-number' },
        { text: ' && "\'', cls: '' }
      ]
    ])
  })

  it('keeps the innermost class of nested tokens', () => {
    const html =
      '<span class="hljs-function"><span class="hljs-keyword">void</span> <span class="hljs-title">Run</span>()</span>'
    expect(htmlToLines(html)).toEqual([
      [
        { text: 'void', cls: 'hljs-keyword' },
        { text: ' ', cls: 'hljs-function' },
        { text: 'Run', cls: 'hljs-title' },
        { text: '()', cls: 'hljs-function' }
      ]
    ])
  })
})

describe('mergeSegments', () => {
  it('cuts the line where either the syntax or the changed words change', () => {
    const syntax = [
      { text: 'let', cls: 'hljs-keyword' },
      { text: ' x = ', cls: '' },
      { text: '12', cls: 'hljs-number' }
    ]
    const words = [
      { text: 'let x = 1', changed: false },
      { text: '2', changed: true }
    ]
    expect(mergeSegments('let x = 12', syntax, words)).toEqual([
      { text: 'let', cls: 'hljs-keyword', changed: false },
      { text: ' x = ', cls: '', changed: false },
      { text: '1', cls: 'hljs-number', changed: false },
      { text: '2', cls: 'hljs-number', changed: true }
    ])
    expect(mergeSegments('abc', undefined, undefined)).toEqual([{ text: 'abc', cls: '', changed: false }])
  })

  it('falls back to the plain text when the tokens do not cover it', () => {
    expect(mergeSegments('abc', [{ text: 'ab', cls: 'x' }], undefined)).toEqual([
      { text: 'abc', cls: '', changed: false }
    ])
  })
})

describe('highlightHunk', () => {
  const line = (type: DiffLine['type'], text: string): DiffLine => ({ type, text })
  const hunk = (lines: DiffLine[]): DiffHunk => ({
    header: '',
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 0,
    lines,
    patch: ''
  })

  it('highlights each side of a hunk as one piece of code, so a comment spanning lines stays a comment', () => {
    const lines = [
      line('ctx', '/* start'),
      line('del', 'old */ int a = 1;'),
      line('add', 'new */ string s = "x";'),
      line('ctx', 'int b = 2;')
    ]
    const tokens = highlightHunk(hunk(lines), 'csharp')!
    const classOf = (i: number, text: string) => tokens.get(i)?.find((t) => t.text.includes(text))?.cls
    expect(classOf(0, 'start')).toBe('hljs-comment')
    expect(classOf(1, 'old')).toBe('hljs-comment')
    expect(classOf(2, 'new')).toBe('hljs-comment')
    expect(classOf(2, '"x"')).toBe('hljs-string')
    expect(classOf(3, '2')).toBe('hljs-number')
  })

  it('leaves out hunks too big to highlight quickly, and unknown languages', () => {
    expect(highlightHunk(hunk([line('add', 'x'.repeat(5000))]), 'csharp')).toBeNull()
    expect(highlightHunk(hunk([line('add', 'x')]), 'no-such-language')).toBeNull()
  })
})
