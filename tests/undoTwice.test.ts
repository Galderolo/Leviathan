import { describe, expect, it, vi } from 'vitest'
import type { RepoChange } from '../src/shared/undo'

// The renderer reads its API from the preload bridge: applying a change ends when the test says so,
// anything else this test does not need fails at once.
const applied: (() => void)[] = []
const stub: Record<string, unknown> = {
  applyChange: vi.fn(() => new Promise<void>((resolve) => applied.push(resolve)))
}
vi.stubGlobal('window', {
  leviathan: new Proxy(stub, {
    get: (target, key: string) => target[key] ?? (() => Promise.reject(new Error(`${key}: not in this test`)))
  })
})

const { undo } = await import('../src/renderer/src/actions')
const { newRepoView, useStore } = await import('../src/renderer/src/store')

const entry = (label: string) => {
  const change: RepoChange = {
    refs: [],
    head: { from: { branch: 'main', hash: `${label}-before` }, to: { branch: 'main', hash: label } },
    mode: 'soft'
  }
  return { label, change }
}

describe('undo', () => {
  it('ignores a second press while the first undo is still being applied', async () => {
    const path = '/repo'
    useStore.setState({ repos: { [path]: { ...newRepoView(path, 100), undo: [entry('first'), entry('second')] } } })
    const one = undo(path)
    const two = undo(path)
    expect(stub.applyChange).toHaveBeenCalledTimes(1)

    applied[0]()
    await Promise.all([one, two])
    const view = useStore.getState().repos[path]
    expect(view.undo.map((e) => e.label)).toEqual(['first'])
    expect(view.redo.map((e) => e.label)).toEqual(['second'])
  })
})
