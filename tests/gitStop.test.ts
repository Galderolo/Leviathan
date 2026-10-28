import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LatestRun } from '../src/main/latestRun'
import { STOPPED, git } from '../src/main/git/runner'

const dir = mkdtempSync(join(tmpdir(), 'leviathan-stop-'))

afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

/** A git command that takes a long time: an alias running a program that waits. */
const slow = ['-c', `alias.slow=!"${process.execPath.replace(/\\/g, '/')}" -e "setTimeout(() => {}, 8000)"`, 'slow']

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
