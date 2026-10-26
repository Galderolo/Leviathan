/** Work running per key (a repository's background fetch), for other work to wait for. */
export function inFlight() {
  const running = new Map<string, Promise<void>>()
  return {
    /** Runs `work` for `key`; null, and nothing started, while work for that key is still running. */
    run(key: string, work: () => Promise<void>): Promise<void> | null {
      if (running.has(key)) return null
      const promise = work()
      const settled = promise.then(
        () => {},
        () => {}
      )
      running.set(key, settled)
      void settled.then(() => running.delete(key))
      return promise
    },
    /** Resolves once the work running for `key` ends, failed or not; at once when none runs. */
    idle(key: string): Promise<void> {
      return running.get(key) ?? Promise.resolve()
    }
  }
}
