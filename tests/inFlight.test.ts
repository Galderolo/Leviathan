import { describe, expect, it } from 'vitest'
import { inFlight } from '../src/renderer/src/inFlight'

const tick = () => new Promise((r) => setTimeout(r, 0))

/** Work that ends when `finish` is called (failing with `fail`). */
function pending() {
  let finish!: () => void
  let fail!: (err: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  return { work: () => promise, finish, fail }
}

describe('inFlight', () => {
  it('lets others wait until the work of a key ends', async () => {
    const work = inFlight()
    const fetch = pending()
    void work.run('repo', fetch.work)
    let idle = false
    void work.idle('repo').then(() => (idle = true))
    await tick()
    expect(idle).toBe(false)

    fetch.finish()
    await tick()
    expect(idle).toBe(true)
  })

  it('is idle at once for a key with nothing running, whatever runs for others', async () => {
    const work = inFlight()
    void work.run('other', pending().work)
    let idle = false
    void work.idle('repo').then(() => (idle = true))
    await tick()
    expect(idle).toBe(true)
  })

  it('becomes idle when the work fails, without passing the error on', async () => {
    const work = inFlight()
    const fetch = pending()
    const running = work.run('repo', fetch.work)
    fetch.fail(new Error('network down'))
    await expect(running).rejects.toThrow('network down')
    await expect(work.idle('repo')).resolves.toBeUndefined()
  })

  it('does not start the work of a key twice at once', async () => {
    const work = inFlight()
    const fetch = pending()
    let starts = 0
    const start = () => {
      starts++
      return fetch.work()
    }
    void work.run('repo', start)
    expect(work.run('repo', start)).toBeNull()
    expect(starts).toBe(1)

    fetch.finish()
    await work.idle('repo')
    void work.run('repo', start)
    expect(starts).toBe(2)
  })
})
