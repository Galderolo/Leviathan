interface Queued<T> {
  arg: T
  promise: Promise<void>
  resolve: () => void
  reject: (err: unknown) => void
}

/**
 * Runs `work` at most once at a time per key. Calls made while it runs are merged (`merge`) into a single run
 * afterwards, and resolve when that run is done: a burst of requests costs two runs, and nobody gets results older
 * than their own request.
 */
export function coalesce<T>(
  work: (key: string, arg: T) => Promise<void>,
  merge: (a: T, b: T) => T
): (key: string, arg: T) => Promise<void> {
  const running = new Set<string>()
  const queued = new Map<string, Queued<T>>()

  const start = (key: string, arg: T): Promise<void> => {
    running.add(key)
    return work(key, arg).finally(() => {
      running.delete(key)
      const next = queued.get(key)
      if (!next) return
      queued.delete(key)
      start(key, next.arg).then(next.resolve, next.reject)
    })
  }

  return (key, arg) => {
    if (!running.has(key)) return start(key, arg)
    const waiting = queued.get(key)
    if (waiting) {
      waiting.arg = merge(waiting.arg, arg)
      return waiting.promise
    }
    let resolve!: () => void
    let reject!: (err: unknown) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    queued.set(key, { arg, promise, resolve, reject })
    return promise
  }
}
