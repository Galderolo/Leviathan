import { describe, expect, it } from 'vitest'
import {
  fileKey,
  globalShortcut,
  keysLabel,
  nextAfter,
  neighbour,
  SHORTCUT_GROUPS
} from '../src/renderer/src/shortcuts'

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
})
const ctrl = (key: string, shiftKey = false) => press(key, { ctrlKey: true, shiftKey })

describe('app-wide shortcuts', () => {
  it('keeps the shortcuts the app already had', () => {
    expect(globalShortcut(ctrl('t'))?.id).toBe('newTab')
    expect(globalShortcut(ctrl('w'))?.id).toBe('closeTab')
    expect(globalShortcut(ctrl('Tab'))?.id).toBe('nextTab')
    expect(globalShortcut(ctrl('Tab', true))?.id).toBe('previousTab')
    expect(globalShortcut(ctrl('o'))?.id).toBe('openRepo')
    expect(globalShortcut(ctrl('z'))?.id).toBe('undo')
    expect(globalShortcut(ctrl('y'))?.id).toBe('redo')
    expect(globalShortcut(ctrl('Z', true))?.id).toBe('redo')
    expect(globalShortcut(ctrl('p'))?.id).toBe('push')
    expect(globalShortcut(ctrl('l'))?.id).toBe('pull')
    expect(globalShortcut(ctrl('f'))?.id).toBe('search')
    expect(globalShortcut(press('F5'))?.id).toBe('refresh')
    // ⌘ on macOS works as Ctrl.
    expect(globalShortcut(press('t', { metaKey: true }))?.id).toBe('newTab')
  })

  it('adds fetch, branch, stash, tabs by number, Settings and the list of shortcuts', () => {
    expect(globalShortcut(ctrl('F', true))?.id).toBe('fetch')
    expect(globalShortcut(ctrl('b'))?.id).toBe('newBranch')
    expect(globalShortcut(ctrl('S', true))?.id).toBe('stash')
    expect(globalShortcut(ctrl('3'))).toEqual({ id: 'goToTab', tab: 3 })
    expect(globalShortcut(ctrl(','))?.id).toBe('settings')
    expect(globalShortcut(ctrl('/'))?.id).toBe('shortcuts')
    // A Spanish keyboard types / with Shift+7.
    expect(globalShortcut(ctrl('/', true))?.id).toBe('shortcuts')
    expect(globalShortcut(press('F1'))?.id).toBe('shortcuts')
  })

  it('leaves alone the keys it does not use', () => {
    expect(globalShortcut(press('t'))).toBeNull()
    expect(globalShortcut(ctrl('P', true))).toBeNull()
    expect(globalShortcut(press('t', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(globalShortcut(ctrl('0'))).toBeNull()
  })
})

describe('keys in a file list', () => {
  it('moves, stages or unstages, and discards', () => {
    expect(fileKey(press('ArrowUp'), false)).toBe('previous')
    expect(fileKey(press('ArrowDown'), false)).toBe('next')
    expect(fileKey(press(' '), false)).toBe('stageToggle')
    expect(fileKey(press('Delete'), false)).toBe('discard')
    // The Mac's delete key is Backspace; alone it would be too easy to press by mistake.
    expect(fileKey(press('Backspace', { metaKey: true }), true)).toBe('discard')
    expect(fileKey(press('Backspace'), true)).toBeNull()
    expect(fileKey(press(' ', { ctrlKey: true }), false)).toBeNull()
    expect(fileKey(press('a'), false)).toBeNull()
  })

  it('goes to the file before or after, from the ends when none is open', () => {
    const order = ['a', 'b', 'c']
    expect(neighbour(order, 'b', 1)).toBe('c')
    expect(neighbour(order, 'b', -1)).toBe('a')
    expect(neighbour(order, 'c', 1)).toBe('c')
    expect(neighbour(order, 'a', -1)).toBe('a')
    expect(neighbour(order, null, 1)).toBe('a')
    expect(neighbour(order, null, -1)).toBe('c')
    expect(neighbour([], null, 1)).toBeNull()
  })

  it('shows the next file once some leave the list', () => {
    const order = ['a', 'b', 'c', 'd']
    expect(nextAfter(order, ['b'], 'b')).toBe('c')
    expect(nextAfter(order, ['b', 'c'], 'b')).toBe('d')
    // The last ones go: the one before them.
    expect(nextAfter(order, ['c', 'd'], 'd')).toBe('b')
    expect(nextAfter(order, ['a', 'b', 'c', 'd'], 'a')).toBeNull()
    expect(nextAfter(order, ['a'], null)).toBe('b')
  })
})

describe('the list of shortcuts', () => {
  it('names the keys as each system does', () => {
    expect(keysLabel(['Mod', 'Shift', 'F'], false)).toBe('Ctrl+Shift+F')
    expect(keysLabel(['Mod', 'Shift', 'F'], true)).toBe('⌘⇧F')
    expect(keysLabel(['Space'], false, { Space: 'Espacio' })).toBe('Espacio')
  })

  it('lists each shortcut once', () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.keys.join('+')))
    expect(new Set(all).size).toBe(all.length)
  })
})
