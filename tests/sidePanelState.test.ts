import { describe, expect, it } from 'vitest'
import { readCollapsed, writeCollapsed } from '../src/renderer/src/sidePanelState'

function fakeStore() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k)
  }
}

describe('side panel folders', () => {
  it('remembers what is collapsed, per repository', () => {
    const store = fakeStore()
    writeCollapsed('/repos/game', { 'local:feat': true, 'section:tags': true, 'local:fix': false }, store)
    writeCollapsed('/repos/tool', { 'section:stashes': true }, store)
    expect(readCollapsed('/repos/game', store)).toEqual({ 'local:feat': true, 'section:tags': true })
    expect(readCollapsed('/repos/tool', store)).toEqual({ 'section:stashes': true })
    expect(readCollapsed('/repos/other', store)).toEqual({})
  })

  it('forgets a repository with nothing collapsed, and survives bad data', () => {
    const store = fakeStore()
    writeCollapsed('/repos/game', { 'local:feat': true }, store)
    writeCollapsed('/repos/game', { 'local:feat': false }, store)
    expect(store.data.size).toBe(0)
    store.setItem('leviathan.collapsed:/repos/game', '{not json')
    expect(readCollapsed('/repos/game', store)).toEqual({})
    store.setItem('leviathan.collapsed:/repos/game', '["local:feat"]')
    expect(readCollapsed('/repos/game', store)).toEqual({})
  })
})
