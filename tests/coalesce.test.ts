import { describe, expect, it } from 'vitest'
import { coalesce } from '../src/renderer/src/coalesce'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('coalesce', () => {
  it('runs once at a time per key; calls meanwhile become one more run, and resolve after it', async () => {
    const runs: string[] = []
    const release: (() => void)[] = []
    const run = coalesce(
      (key: string, arg: string) =>
        new Promise<void>((resolve) => {
          runs.push(`${key}:${arg}`)
          release.push(resolve)
        }),
      (a, b) => a + b
    )
    const first = run('repo', 'a')
    const second = run('repo', 'b')
    const third = run('repo', 'c')
    const other = run('other', 'x')
    expect(runs).toEqual(['repo:a', 'other:x'])

    release.shift()!()
    await first
    await tick()
    expect(runs).toEqual(['repo:a', 'other:x', 'repo:bc'])
    let secondDone = false
    void second.then(() => (secondDone = true))
    await tick()
    expect(secondDone).toBe(false)

    release.shift()!()
    await other
    release.shift()!()
    await Promise.all([second, third])
    expect(runs).toHaveLength(3)

    // Idle again: the next call runs straight away.
    void run('repo', 'd')
    expect(runs).toEqual(['repo:a', 'other:x', 'repo:bc', 'repo:d'])
  })

  it('passes a failure on to the callers of that run, and keeps going', async () => {
    let fail = true
    const run = coalesce(
      async () => {
        if (fail) throw new Error('boom')
      },
      (a: number, b: number) => a + b
    )
    await expect(run('repo', 1)).rejects.toThrow('boom')
    fail = false
    await expect(run('repo', 2)).resolves.toBeUndefined()
  })
})
