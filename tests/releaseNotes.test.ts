import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  inlineSpans,
  noteBlocks,
  parseChangelog,
  parseGithubReleases
} from '../src/shared/releaseNotes'

describe('parseGithubReleases', () => {
  it('keeps published releases, newest first, without the policy links added to every release', () => {
    const json = [
      {
        tag_name: 'v0.8.1',
        published_at: '2026-10-22T13:40:00Z',
        prerelease: true,
        draft: false,
        html_url: 'https://github.com/Galderolo/Leviathan/releases/tag/v0.8.1',
        body: '### Fixed\n\n- A fix.\n\n---\n\n[Code signing policy](https://x) · [Privacy policy](https://y)\n'
      },
      { tag_name: 'v0.9.0', draft: true, body: 'not yet' },
      { tag_name: 'v1.0.0', published_at: '2026-11-01T10:00:00Z', prerelease: false, draft: false, body: null }
    ]
    expect(parseGithubReleases(json)).toEqual([
      { version: '1.0.0', date: '2026-11-01', prerelease: false, body: '', url: null },
      {
        version: '0.8.1',
        date: '2026-10-22',
        prerelease: true,
        body: '### Fixed\n\n- A fix.',
        url: 'https://github.com/Galderolo/Leviathan/releases/tag/v0.8.1'
      }
    ])
  })

  it('returns nothing for an answer it does not understand', () => {
    expect(parseGithubReleases({ message: 'API rate limit exceeded' })).toEqual([])
    expect(parseGithubReleases(null)).toEqual([])
  })
})

describe('parseChangelog', () => {
  it('reads every released version of CHANGELOG.md, not the unreleased part', () => {
    const text = [
      '# Changelog',
      '',
      'Intro.',
      '',
      '## [Unreleased]',
      '',
      '- Coming soon.',
      '',
      '## [0.8.1] - 2026-10-22',
      '',
      '### Fixed',
      '',
      '- A fix.',
      '',
      '## [0.8.0] - 2026-10-21',
      '',
      '### Added',
      '',
      '- Submodules.',
      ''
    ].join('\n')
    expect(parseChangelog(text)).toEqual([
      { version: '0.8.1', date: '2026-10-22', prerelease: false, body: '### Fixed\n\n- A fix.', url: null },
      { version: '0.8.0', date: '2026-10-21', prerelease: false, body: '### Added\n\n- Submodules.', url: null }
    ])
  })
})

describe('noteBlocks', () => {
  it('turns release notes into headings, nested list items and paragraphs', () => {
    const body =
      '### Added\n\n- Big repositories:\n  - Virtual lists.\n  - Ahead/behind\n    cache.\n- Shortcuts.\n\nSome text\non two lines.'
    expect(noteBlocks(body)).toEqual([
      { kind: 'heading', text: 'Added' },
      { kind: 'item', depth: 0, text: 'Big repositories:' },
      { kind: 'item', depth: 1, text: 'Virtual lists.' },
      { kind: 'item', depth: 1, text: 'Ahead/behind cache.' },
      { kind: 'item', depth: 0, text: 'Shortcuts.' },
      { kind: 'paragraph', text: 'Some text on two lines.' }
    ])
  })
})

describe('inlineSpans', () => {
  it('reads code, emphasis and links, and leaves everything else as text', () => {
    expect(
      inlineSpans('Press `Ctrl+P`, see *Settings → Updates* and [the docs](https://example.com). <b>no</b>')
    ).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'code', text: 'Ctrl+P' },
      { kind: 'text', text: ', see ' },
      { kind: 'em', text: 'Settings → Updates' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'the docs', href: 'https://example.com' },
      { kind: 'text', text: '. <b>no</b>' }
    ])
    expect(inlineSpans('**strong** [bad](javascript:alert(1))')).toEqual([
      { kind: 'strong', text: 'strong' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: 'bad' }
    ])
  })
})

describe('compareVersions', () => {
  it('orders versions by their numbers', () => {
    expect(['0.10.0', '0.8.1', '0.9.0', '0.8.0'].sort(compareVersions)).toEqual(['0.8.0', '0.8.1', '0.9.0', '0.10.0'])
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
})
