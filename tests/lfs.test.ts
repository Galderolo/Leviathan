import { describe, expect, it } from 'vitest'
import { lfsPatternFor, parseAttributes, parseLocks, parseVerifiedLocks } from '../src/shared/lfs'

describe('parseAttributes', () => {
  it('keeps the patterns that go through LFS, and which of them are lockable', () => {
    const text = [
      '# assets',
      '',
      '[attr]binary -diff -merge -text',
      '*.psd filter=lfs diff=lfs merge=lfs -text lockable',
      '*.fbx filter=lfs diff=lfs merge=lfs -text',
      '*.txt text eol=lf',
      '*.wav filter=lfs -lockable'
    ].join('\r\n')
    expect(parseAttributes(text, '.gitattributes')).toEqual([
      { pattern: '*.psd', lockable: true, source: '.gitattributes' },
      { pattern: '*.fbx', lockable: false, source: '.gitattributes' },
      { pattern: '*.wav', lockable: false, source: '.gitattributes' }
    ])
  })

  it('lets a later line for the same pattern change or remove it', () => {
    const text = '*.psd filter=lfs\n*.bin filter=lfs\n*.psd filter=lfs lockable\n*.bin -filter\n*.png filter=other\n'
    expect(parseAttributes(text, 'art/.gitattributes')).toEqual([
      { pattern: '*.psd', lockable: true, source: 'art/.gitattributes' }
    ])
  })

  it('reads quoted patterns', () => {
    expect(parseAttributes('"my file.bin" filter=lfs\n"a\\"b.bin" filter=lfs', '.gitattributes')).toEqual([
      { pattern: 'my file.bin', lockable: false, source: '.gitattributes' },
      { pattern: 'a"b.bin', lockable: false, source: '.gitattributes' }
    ])
  })
})

describe('locks', () => {
  const lock = (id: string, path: string, owner: string) => ({
    id,
    path,
    owner: { name: owner },
    locked_at: '2026-10-22T08:47:07.12Z'
  })

  it('reads the list of locks', () => {
    expect(parseLocks(JSON.stringify([lock('1', 'a.psd', 'ana')]), null)).toEqual([
      { id: '1', path: 'a.psd', owner: 'ana', lockedAt: '2026-10-22T08:47:07.12Z', mine: null }
    ])
  })

  it('tells my locks from the others when the server verified them', () => {
    const json = JSON.stringify({ ours: [lock('1', 'a.psd', 'me')], theirs: [lock('2', 'b.psd', 'ana')] })
    expect(parseVerifiedLocks(json).map((l) => [l.path, l.owner, l.mine])).toEqual([
      ['a.psd', 'me', true],
      ['b.psd', 'ana', false]
    ])
  })

  it('returns nothing for output it cannot read', () => {
    expect(parseLocks('Error', null)).toEqual([])
    expect(parseLocks('{}', true)).toEqual([])
    expect(parseVerifiedLocks('[]')).toEqual([])
    expect(parseLocks(JSON.stringify([{ id: 3 }]), null)).toEqual([])
  })
})

describe('lfsPatternFor', () => {
  it('tracks a file by its extension, or by its path when it has none', () => {
    expect(lfsPatternFor('art/Hero.PSD')).toBe('*.PSD')
    expect(lfsPatternFor('Makefile')).toBe('Makefile')
    expect(lfsPatternFor('dir/.env')).toBe('dir/.env')
    expect(lfsPatternFor('build/game.tar.gz')).toBe('*.gz')
  })
})
