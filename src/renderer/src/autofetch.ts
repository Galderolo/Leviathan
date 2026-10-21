/** True when a background fetch should run (`minutes <= 0` disables it). */
export function isFetchDue(lastFetchAt: number | null, now: number, minutes: number): boolean {
  if (minutes <= 0) return false
  if (lastFetchAt === null) return true
  return now - lastFetchAt >= minutes * 60_000
}
