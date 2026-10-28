import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { LatestRun } from '../src/main/latestRun'
import { STOPPED, git } from '../src/main/git/runner'

// Not a folder of its own: on Windows the program git started outlives git for a moment, and its folder could not be
// removed meanwhile.
const dir = tmpdir()

/** A git command that takes a long time: an alias running a program that waits. */
const slow = ['-c', `alias.slow=!"${process.execPath.replace(/\\/g, '/')}" -e "setTimeout(() => {}, 5000)"`, 'slow']

describe('stopping a git command', () => {
  it('stops a command that is running, at once', async () => {
    const control = new AbortController()
    const started = Date.now()
    const running = git(slow, { cwd: dir, signal: control.signal })
    setTimeout(() => control.abort(), 200)
    await expect(running).rejects.toThrow(STOPPED)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('does not start a command already stopped', async () => {
    const control = new AbortController()
    control.abort()
    await expect(git(['--version'], { cwd: dir, signal: control.signal })).rejects.toThrow(STOPPED)
  })
})

describe('LatestRun', () => {
  it('stops the run before when a newer one starts, or when told', () => {
    const runs = new LatestRun()
    const first = runs.start('/repo')
    const other = runs.start('/other')
    const second = runs.start('/repo')
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
    runs.stop('/repo')
    expect(second.aborted).toBe(true)
    expect(other.aborted).toBe(false)
  })
})
