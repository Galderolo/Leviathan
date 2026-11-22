import { describe, expect, it } from 'vitest'
import {
  bitbucketSlug,
  canPublish,
  projectLocation,
  projectName,
  projectNameProblem,
  PROJECT_NAME_MAX
} from '../src/shared/publish'

describe('projectName', () => {
  it('keeps a name servers accept as it is', () => {
    expect(projectName('game')).toBe('game')
    expect(projectName('My_Game-2.0')).toBe('My_Game-2.0')
  })

  it('turns spaces and symbols into one dash each run', () => {
    expect(projectName('My Game')).toBe('My-Game')
    expect(projectName('a  &  b')).toBe('a-b')
    expect(projectName('  padded  ')).toBe('padded')
  })

  it('drops accents instead of the letters', () => {
    expect(projectName('Juego Ñandú')).toBe('Juego-Nandu')
  })

  it('drops dots and dashes at the edges, and a trailing .git', () => {
    expect(projectName('.hidden')).toBe('hidden')
    expect(projectName('-x-')).toBe('x')
    expect(projectName('game.git')).toBe('game')
    expect(projectName('game-.git')).toBe('game')
  })

  it('cuts a long name, without leaving a dash at the end', () => {
    const name = projectName('a'.repeat(99) + ' bcd')
    expect(name.length).toBeLessThanOrEqual(PROJECT_NAME_MAX)
    expect(name).toBe('a'.repeat(99))
  })

  it('may leave nothing', () => {
    expect(projectName('***')).toBe('')
    expect(projectName('')).toBe('')
  })
})

describe('projectNameProblem', () => {
  it('accepts what projectName makes', () => {
    expect(projectNameProblem('My-Game')).toBeNull()
    expect(projectNameProblem('a.b_c-d')).toBeNull()
  })

  it('says what is wrong', () => {
    expect(projectNameProblem('')).toBe('empty')
    expect(projectNameProblem('a'.repeat(101))).toBe('tooLong')
    expect(projectNameProblem('my game')).toBe('characters')
    expect(projectNameProblem('juego-ñ')).toBe('characters')
    expect(projectNameProblem('game.git')).toBe('dotGit')
    expect(projectNameProblem('-game')).toBe('edge')
    expect(projectNameProblem('game.')).toBe('edge')
  })
})

describe('bitbucketSlug', () => {
  it('is the name in lower case', () => {
    expect(bitbucketSlug('My-Game')).toBe('my-game')
  })
})

describe('projectLocation', () => {
  it('is the user and the name on the host', () => {
    expect(projectLocation({ provider: 'github', host: 'github.com', username: 'ana' }, '', 'game')).toBe(
      'github.com/ana/game'
    )
  })

  it('on Bitbucket, the workspace and the slug', () => {
    expect(projectLocation({ provider: 'bitbucket', host: 'bitbucket.org', username: 'ana' }, 'team', 'My-Game')).toBe(
      'bitbucket.org/team/my-game'
    )
  })
})

describe('canPublish', () => {
  it('needs a provider with an API', () => {
    expect(canPublish({ provider: 'github' })).toBe(true)
    expect(canPublish({ provider: 'gitlab' })).toBe(true)
    expect(canPublish({ provider: 'bitbucket' })).toBe(true)
    expect(canPublish({ provider: 'gitea' })).toBe(true)
    expect(canPublish({ provider: 'other' })).toBe(false)
  })
})
