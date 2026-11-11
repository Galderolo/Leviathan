import { describe, expect, it } from 'vitest'
import {
  attributesChanged,
  formatSize,
  lfsInfoKey,
  lockFor,
  lockedByOthers,
  patternLabel
} from '../src/renderer/src/lfsView'
import type { LfsLock } from '../src/shared/lfs'
import type { FileChange, RepoState } from '../src/shared/types'

function state(hash: string, unstaged: FileChange[], staged: FileChange[] = []): RepoState {
  return {
    path: '/r',
    head: { branch: 'main', hash, detached: false, upstream: null, ahead: 0, behind: 0 },
    refs: [],
    stashes: [],
    remotes: [],
    status: { staged, unstaged, conflicted: [] },
    operation: null,
    editing: null,
    bisect: null,
    unpushed: [],
    lfsFiles: [],
    largeFiles: [],
    unconvertedLfs: []
  }
}

const lock = (path: string, mine: boolean | null, owner = 'ana'): LfsLock => ({
  id: path,
  path,
  owner,
  lockedAt: '2026-10-22T10:00:00Z',
  mine
})

describe('when to read the LFS patterns again', () => {
  it('changes with the checked-out commit and with edits to attributes files', () => {
    const base = lfsInfoKey(state('a', [{ path: 'x.psd', status: 'M' }]))
    expect(lfsInfoKey(state('a', [{ path: 'y.psd', status: '?' }]))).toBe(base)
    expect(lfsInfoKey(state('b', []))).not.toBe(base)
    expect(lfsInfoKey(state('a', [{ path: '.gitattributes', status: 'M' }]))).not.toBe(base)
    expect(lfsInfoKey(state('a', [], [{ path: 'art/.gitattributes', status: 'A' }]))).not.toBe(base)
  })

  it('knows when an attributes file is among the changes', () => {
    expect(attributesChanged(state('a', [{ path: 'art/.gitattributes', status: 'M' }]))).toBe(true)
    expect(attributesChanged(state('a', [{ path: 'my.gitattributes', status: 'M' }]))).toBe(false)
  })
})

describe('locks of files', () => {
  const locks = [lock('a.psd', true, 'me'), lock('b.psd', false), lock('c.psd', null)]

  it('finds the lock of a file', () => {
    expect(lockFor(locks, 'b.psd')?.owner).toBe('ana')
    expect(lockFor(locks, 'd.psd')).toBeNull()
    expect(lockFor(undefined, 'a.psd')).toBeNull()
  })

  it('looks the locks up by path, without going through the whole list for each file', () => {
    const many = Array.from({ length: 2000 }, (_, i) => lock(`art/${i}.psd`, false))
    let reads = 0
    const counted = new Proxy(many, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      }
    })
    for (let i = 0; i < many.length; i++) expect(lockFor(counted, `art/${i}.psd`)?.id).toBe(`art/${i}.psd`)
    expect(lockFor(counted, 'art/missing.psd')).toBeNull()
    // Reading the list once to index it, not once per file (2000 × 1000 on average).
    expect(reads).toBeLessThanOrEqual(many.length)
  })

  it('reads a new list of locks again', () => {
    const before = [lock('a.psd', true, 'me')]
    expect(lockFor(before, 'a.psd')?.owner).toBe('me')
    const after = [lock('a.psd', false, 'ana')]
    expect(lockFor(after, 'a.psd')?.owner).toBe('ana')
    expect(lockFor(before, 'a.psd')?.owner).toBe('me')
  })

  it("lists changed files someone else locked, never the user's own or unknown ones", () => {
    expect(lockedByOthers(locks, ['a.psd', 'b.psd', 'c.psd', 'd.psd']).map((l) => l.path)).toEqual(['b.psd'])
  })
})

describe('labels', () => {
  it('shows a pattern with the folder of its attributes file', () => {
    expect(patternLabel({ pattern: '*.psd', lockable: false, source: '.gitattributes' })).toBe('*.psd')
    expect(patternLabel({ pattern: '*.wav', lockable: false, source: 'audio/sfx/.gitattributes' })).toBe(
      'audio/sfx/*.wav'
    )
  })

  it('shows the spaces that .gitattributes writes as [[:space:]]', () => {
    const pattern = 'Assets/TextMesh[[:space:]]Pro/Shaders/**'
    expect(patternLabel({ pattern, lockable: false, source: '.gitattributes' })).toBe('Assets/TextMesh Pro/Shaders/**')
  })

  it('formats file sizes', () => {
    expect(formatSize(51 * 1024 * 1024 + 1024)).toBe('51 MB')
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
    expect(formatSize(2048)).toBe('2 KB')
  })
})
