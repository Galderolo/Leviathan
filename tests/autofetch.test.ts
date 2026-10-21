import { describe, expect, it } from 'vitest'
import { isFetchDue } from '../src/renderer/src/autofetch'

const MIN = 60_000

describe('isFetchDue', () => {
  it('never fetches when disabled', () => {
    expect(isFetchDue(null, 10 * MIN, 0)).toBe(false)
  })

  it('fetches right away when the repository was never fetched', () => {
    expect(isFetchDue(null, 0, 10)).toBe(true)
  })

  it('waits for the interval to pass', () => {
    expect(isFetchDue(0, 9 * MIN, 10)).toBe(false)
    expect(isFetchDue(0, 10 * MIN, 10)).toBe(true)
  })
})
