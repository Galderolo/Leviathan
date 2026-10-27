import { describe, expect, it, vi } from 'vitest'
import type { LfsInfo } from '../src/shared/lfs'

// The renderer reads its API from the preload bridge: answers come back when the test says so.
const answers: ((info: LfsInfo) => void)[] = []
vi.stubGlobal('window', {
  leviathan: { getLfsInfo: () => new Promise<LfsInfo>((resolve) => answers.push(resolve)) }
})

const { loadLfsInfo } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

const info = (pattern: string): LfsInfo => ({
  version: '3.4.0',
  used: true,
  filters: true,
  hooks: true,
  patterns: [{ pattern, lockable: false, source: '.gitattributes' }]
})

describe('loadLfsInfo', () => {
  it('keeps the patterns of the last checkout when the answer of an earlier one comes back later', async () => {
    const path = '/repo'
    useStore.setState({ repos: { [path]: newRepoView(path, 100) } })
    // Two quick checkouts: one branch tracks *.psd, the next one *.fbx.
    const first = loadLfsInfo(path)
    const second = loadLfsInfo(path)
    answers[1](info('*.fbx'))
    await second
    answers[0](info('*.psd'))
    await first
    expect(useStore.getState().repos[path].lfs?.info.patterns.map((p) => p.pattern)).toEqual(['*.fbx'])
  })
})
