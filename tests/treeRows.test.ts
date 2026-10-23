import { describe, expect, it } from 'vitest'
import { buildTree, visibleTreeRows } from '../src/renderer/src/utils'

const names = ['main', 'feature/login', 'feature/ui/menu', 'feature/ui/hud', 'fix/crash']
const tree = buildTree(names, (n) => n)
const shown = (rows: ReturnType<typeof visibleTreeRows<string>>) =>
  rows.map((r) => `${'  '.repeat(r.depth)}${r.node.item ? '' : '/'}${r.node.name}`)

describe('visibleTreeRows', () => {
  it('lists folders and branches in order, with their depth, under unfolded folders', () => {
    // buildTree puts folders first, then names in order.
    expect(shown(visibleTreeRows(tree, 'local:', {}))).toEqual([
      '/feature',
      '  /ui',
      '    hud',
      '    menu',
      '  login',
      '/fix',
      '  crash',
      'main'
    ])
  })

  it('leaves out what is inside a folded folder, with keys unique per section', () => {
    const rows = visibleTreeRows(tree, 'local:', { 'local:feature/ui': true, 'local:fix': true })
    expect(shown(rows)).toEqual(['/feature', '  /ui', '  login', '/fix', 'main'])
    expect(rows.map((r) => r.key)).toEqual([
      'local:feature',
      'local:feature/ui',
      'local:feature/login',
      'local:fix',
      'local:main'
    ])
  })
})

describe('buildTree', () => {
  it('stays quick with thousands of branches', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `team${i % 50}/feature-${i}`)
    const t0 = performance.now()
    const built = buildTree(many, (n) => n)
    expect(performance.now() - t0).toBeLessThan(100)
    expect(built).toHaveLength(50)
    expect(built[0].children).toHaveLength(100)
  })
})
