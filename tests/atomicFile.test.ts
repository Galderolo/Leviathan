import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../src/main/atomicFile'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leviathan-atomic-'))
  file = join(dir, 'settings.json')
  writeFileSync(file, 'one')
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

/** A rename that fails `times` times with `code` (Windows, while an antivirus has the file open), then works. */
function busyFor(times: number, code = 'EPERM') {
  let calls = 0
  const rename = (from: string, to: string) => {
    if (++calls <= times) throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code })
    renameSync(from, to)
  }
  return { rename, calls: () => calls }
}

describe('writeFileAtomic', () => {
  it('replaces the file in one step', () => {
    writeFileAtomic(file, 'two')
    expect(readFileSync(file, 'utf8')).toBe('two')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('tries the rename again while another program has the file open', () => {
    const busy = busyFor(3)
    writeFileAtomic(file, 'two', busy.rename)
    expect(readFileSync(file, 'utf8')).toBe('two')
    expect(busy.calls()).toBe(4)
  })

  it('gives up after a moment, and at once on any other error', () => {
    expect(() => writeFileAtomic(file, 'two', busyFor(100, 'EBUSY').rename)).toThrow('EBUSY')
    const missing = busyFor(1, 'ENOENT')
    expect(() => writeFileAtomic(file, 'two', missing.rename)).toThrow('ENOENT')
    expect(missing.calls()).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe('one')
  })
})
