import { renameSync, writeFileSync } from 'node:fs'

/** What Windows answers while another program (an antivirus, the search indexer) has the file open for a moment. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * Writes `text` to `file` in one step: a file next to it, renamed over it, so a crash never leaves half a file. The
 * rename is tried again for about a second while the file is busy.
 */
export function writeFileAtomic(
  file: string,
  text: string,
  rename: (from: string, to: string) => void = renameSync
): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text, 'utf8')
  for (let wait = 10; ; wait *= 2) {
    try {
      return rename(tmp, file)
    } catch (err) {
      if (!BUSY.has((err as NodeJS.ErrnoException).code ?? '') || wait > 640) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
    }
  }
}
