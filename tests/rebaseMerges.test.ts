import { describe, expect, it } from 'vitest'
import { parseRebaseScript, planRebaseWithMerges, rebaseProblemWithMerges, type RebaseItem } from '../src/shared/rebase'

const commits = ['06164ce1', '4719954a', 'b02b1e2c', 'bc3cae3d'].map((hash) => ({ hash: hash.padEnd(40, '0') }))
const full = (short: string) => commits.find((c) => c.hash.startsWith(short))!.hash

/** What `git rebase -i --rebase-merges` writes for a branch merged in, between two commits of main. */
const SCRIPT = [
  'label onto',
  '',
  '# Branch Merge-feature',
  'reset onto',
  'pick 06164ce feature one',
  'pick 4719954 feature two',
  'label Merge-feature',
  '',
  'reset onto',
  'pick b02b1e2 main one',
  "merge -C 86524c7 Merge-feature # Merge branch 'feature'",
  'pick bc3cae3 main two',
  '',
  '# Rebase 1111111..bc3cae3 onto 1111111 (9 commands)'
].join('\n')

const items = (actions: Partial<Record<string, RebaseItem['action']>>, messages: Record<string, string> = {}) =>
  ['06164ce', '4719954', 'b02b1e2', 'bc3cae3'].map((short) => ({
    hash: full(short),
    action: actions[short] ?? 'pick',
    ...(messages[short] ? { message: messages[short] } : {})
  }))

describe('parseRebaseScript', () => {
  it("reads git's list: its commits, its merges, and the lines that keep the branches apart", () => {
    const lines = parseRebaseScript(SCRIPT, commits)
    expect(lines.filter((l) => l.kind === 'pick').map((l) => l.kind === 'pick' && l.hash)).toEqual(
      commits.map((c) => c.hash)
    )
    expect(lines.filter((l) => l.kind === 'merge')).toEqual([
      {
        kind: 'merge',
        subject: "Merge branch 'feature'",
        text: "merge -C 86524c7 Merge-feature # Merge branch 'feature'"
      }
    ])
    expect(lines.filter((l) => l.kind === 'other').map((l) => l.kind === 'other' && l.text)).toEqual([
      'label onto',
      'reset onto',
      'label Merge-feature',
      'reset onto'
    ])
  })

  it('refuses a list naming a commit it was not given', () => {
    expect(() => parseRebaseScript('pick deadbee unknown', commits)).toThrow('deadbee')
  })
})

describe('rebaseProblemWithMerges', () => {
  const lines = parseRebaseScript(SCRIPT, commits)

  it('lets a squash or fixup meld only into a commit of its own branch', () => {
    expect(rebaseProblemWithMerges(lines, items({ '4719954': 'squash' }))).toBeNull()
    // The first of main's commits comes right after a reset: nothing of its branch before it.
    expect(rebaseProblemWithMerges(lines, items({ b02b1e2: 'fixup' }))).toBe('noBase')
    // After the merge, the merge is what it melds into: not supported, a merge is kept as it is.
    expect(rebaseProblemWithMerges(lines, items({ bc3cae3: 'squash' }))).toBe('noBase')
  })

  it('needs a message for a reword, and something left to rebase', () => {
    expect(rebaseProblemWithMerges(lines, items({ '06164ce': 'reword' }))).toBe('noMessage')
    expect(
      rebaseProblemWithMerges(lines, items({ '06164ce': 'drop', '4719954': 'drop', b02b1e2: 'drop', bc3cae3: 'drop' }))
    ).toBe('empty')
  })
})

describe('planRebaseWithMerges', () => {
  it("keeps git's labels, resets and merges, and plans each branch's commits as a rebase of their own", () => {
    const lines = parseRebaseScript(SCRIPT, commits)
    const plan = planRebaseWithMerges(
      lines,
      items({ '06164ce': 'reword', bc3cae3: 'drop' }, { '06164ce': 'feature first' }),
      () => 'old message',
      (name) => `/r/${name}`
    )
    const todo = plan.todo.split('\n').filter(Boolean)
    expect(todo[0]).toBe('label onto')
    expect(todo).toContain("merge -C 86524c7 Merge-feature # Merge branch 'feature'")
    expect(todo).toContain(`drop ${full('bc3cae3')}`)
    expect(todo).toContain(`pick ${full('b02b1e2')}`)
    // The reword amends its commit before the branch is labelled, so the merge takes the new one.
    const amend = todo.findIndex((l) => l.includes('commit --amend'))
    expect(amend).toBeGreaterThan(todo.indexOf(`pick ${full('06164ce')}`))
    expect(amend).toBeLessThan(todo.indexOf('label Merge-feature'))
    expect(Object.values(plan.files)).toContain('feature first')
    // Each branch's helper files are its own.
    expect(new Set(Object.keys(plan.files)).size).toBe(Object.keys(plan.files).length)
  })
})
