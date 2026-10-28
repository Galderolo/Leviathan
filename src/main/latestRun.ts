/** One run at a time per key: starting a newer one, or stopping, ends the one before (its signal aborts). */
export class LatestRun {
  private runs = new Map<string, AbortController>()

  start(key: string): AbortSignal {
    this.runs.get(key)?.abort()
    const control = new AbortController()
    this.runs.set(key, control)
    return control.signal
  }

  stop(key: string): void {
    this.runs.get(key)?.abort()
    this.runs.delete(key)
  }
}
