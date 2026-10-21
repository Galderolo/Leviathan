import { describe, expect, it } from 'vitest'
import {
  parseDiff,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashes,
  parseStatus,
  untrackedDiff
} from '../src/shared/parsers'

const F = '\x1f'
const R = '\x1e'

describe('parseLog', () => {
  it('parses records with and without parents', () => {
    const out =
      ['aaa', 'bbb ccc', 'Ana', 'ana@x', '10', 'Bob', 'bob@x', '11', 'Merge: things'].join(F) +
      R +
      '\n' +
      ['ccc', '', 'Ana', 'ana@x', '5', 'Ana', 'ana@x', '5', 'Initial'].join(F) +
      R +
      '\n'
    const commits = parseLog(out)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({ hash: 'aaa', parents: ['bbb', 'ccc'], authorDate: 10, subject: 'Merge: things' })
    expect(commits[1].parents).toEqual([])
  })
})

describe('parseRefs', () => {
  it('classifies heads, remotes and tags, skipping symrefs', () => {
    const out = [
      ['refs/heads/main', 'h1', '', 'origin/main', '[ahead 2, behind 1]', '*', ''].join(F),
      ['refs/heads/feature/x', 'h2', '', '', '', ' ', ''].join(F),
      ['refs/remotes/origin/HEAD', 'h1', '', '', '', ' ', 'refs/remotes/origin/main'].join(F),
      ['refs/remotes/origin/main', 'h3', '', '', '', ' ', ''].join(F),
      ['refs/remotes/my/fork/dev', 'h4', '', '', '', ' ', ''].join(F),
      ['refs/tags/v1', 'tagobj', 'h5', '', '', ' ', ''].join(F),
      ['refs/heads/old', 'h6', '', 'origin/old', '[gone]', ' ', ''].join(F)
    ].join('\n')
    const refs = parseRefs(out, ['origin', 'my/fork'])
    expect(refs).toHaveLength(6)
    expect(refs[0]).toMatchObject({
      name: 'main',
      type: 'head',
      isHead: true,
      ahead: 2,
      behind: 1,
      upstream: 'origin/main'
    })
    expect(refs[1]).toMatchObject({ name: 'feature/x', isHead: false })
    expect(refs[2]).toMatchObject({ name: 'origin/main', type: 'remote', remote: 'origin' })
    expect(refs[3]).toMatchObject({ name: 'my/fork/dev', remote: 'my/fork' })
    expect(refs[4]).toMatchObject({ name: 'v1', type: 'tag', hash: 'h5' })
    expect(refs[5]).toMatchObject({ upstreamGone: true })
  })
})

describe('parseStatus', () => {
  it('parses branch headers, staged, unstaged, renames, conflicts and untracked files', () => {
    const entries = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +1 -3',
      '1 M. N... 100644 100644 100644 h1 h2 staged file.txt',
      '1 .M N... 100644 100644 100644 h1 h2 src/mod.ts',
      '1 MM N... 100644 100644 100644 h1 h2 both.ts',
      '2 R. N... 100644 100644 100644 h1 h2 R100 new name.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.ts',
      '? untracked dir/file.md',
      '1 .D N... 100644 100644 000000 h1 h1 gone.ts'
    ]
    const { head, status } = parseStatus(entries.join('\0') + '\0')
    expect(head).toEqual({ branch: 'main', hash: 'abc', detached: false, upstream: 'origin/main', ahead: 1, behind: 3 })
    expect(status.staged).toEqual([
      { path: 'staged file.txt', status: 'M' },
      { path: 'both.ts', status: 'M' },
      { path: 'new name.ts', origPath: 'old name.ts', status: 'R' }
    ])
    expect(status.unstaged).toEqual([
      { path: 'src/mod.ts', status: 'M' },
      { path: 'both.ts', status: 'M' },
      { path: 'untracked dir/file.md', status: '?' },
      { path: 'gone.ts', status: 'D' }
    ])
    expect(status.conflicted).toEqual([{ path: 'conflict.ts', status: 'U' }])
  })

  it('handles detached and unborn HEAD', () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0').head.hash).toBeNull()
    expect(parseStatus('# branch.oid abc\0# branch.head (detached)\0').head).toMatchObject({
      detached: true,
      branch: null
    })
  })
})

describe('parseStashes', () => {
  it('parses stash list output', () => {
    const out = ['s1', 'base1 idx1', 'stash@{0}', 'WIP on main: abc msg', '50'].join(F) + '\n'
    expect(parseStashes(out)).toEqual([
      { index: 0, ref: 'stash@{0}', hash: 's1', baseHash: 'base1', message: 'WIP on main: abc msg', date: 50 }
    ])
  })
})

describe('parseRemotes', () => {
  it('merges fetch and push urls', () => {
    const out = 'origin\thttps://a/b.git (fetch)\norigin\tgit@a:b.git (push)\n'
    expect(parseRemotes(out)).toEqual([{ name: 'origin', fetchUrl: 'https://a/b.git', pushUrl: 'git@a:b.git' }])
  })
})

describe('parseNameStatus', () => {
  it('parses modifications and renames', () => {
    const out = ['M', 'a.ts', 'R087', 'old.ts', 'new.ts', 'A', 'b c.ts', 'D', 'd.ts', ''].join('\0')
    expect(parseNameStatus(out)).toEqual([
      { path: 'a.ts', status: 'M' },
      { path: 'new.ts', origPath: 'old.ts', status: 'R' },
      { path: 'b c.ts', status: 'A' },
      { path: 'd.ts', status: 'D' }
    ])
  })
})

describe('parseDiff', () => {
  const raw = [
    'diff --git a/f.txt b/f.txt',
    'index 111..222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,3 +1,3 @@',
    ' one',
    '-two',
    '+TWO',
    ' three',
    '@@ -10 +10,2 @@ fn()',
    ' ten',
    '+eleven',
    '\\ No newline at end of file',
    ''
  ].join('\n')

  it('splits hunks and numbers lines', () => {
    const diff = parseDiff(raw, 'fallback')
    expect(diff.path).toBe('f.txt')
    expect(diff.binary).toBe(false)
    expect(diff.header).toBe('diff --git a/f.txt b/f.txt\nindex 111..222 100644\n--- a/f.txt\n+++ b/f.txt\n')
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks[0].lines).toEqual([
      { type: 'ctx', oldNo: 1, newNo: 1, text: 'one' },
      { type: 'del', oldNo: 2, text: 'two' },
      { type: 'add', newNo: 2, text: 'TWO' },
      { type: 'ctx', oldNo: 3, newNo: 3, text: 'three' }
    ])
    expect(diff.hunks[1]).toMatchObject({ oldStart: 10, oldLines: 1, newStart: 10, newLines: 2 })
    expect(diff.hunks[1].lines[2].type).toBe('meta')
  })

  it('keeps raw hunk patches that can be re-applied', () => {
    const diff = parseDiff(raw, 'f.txt')
    expect(diff.hunks[0].patch).toBe('@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n')
  })

  it('strips the tab git appends to file names with spaces', () => {
    const out =
      'diff --git a/my file.txt b/my file.txt\n--- a/my file.txt\t\n+++ b/my file.txt\t\n@@ -1 +1 @@\n-a\n+b\n'
    expect(parseDiff(out, 'fallback').path).toBe('my file.txt')
  })

  it('detects binary files and renames', () => {
    const bin = parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n', 'x.png')
    expect(bin.binary).toBe(true)
    const ren = parseDiff('diff --git a/a b/b\nsimilarity index 100%\nrename from a\nrename to b\n', 'b')
    expect(ren).toMatchObject({ path: 'b', oldPath: 'a', hunks: [] })
  })
})

describe('untrackedDiff', () => {
  it('turns file content into added lines', () => {
    const diff = untrackedDiff('n.txt', 'a\r\nb\n')
    expect(diff.hunks[0].lines).toEqual([
      { type: 'add', newNo: 1, text: 'a' },
      { type: 'add', newNo: 2, text: 'b' }
    ])
  })
})
