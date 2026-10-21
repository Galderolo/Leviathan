import type { GitRef } from '../../shared/types'

/** MIME type used to carry a ref's full name while dragging. */
export const REF_MIME = 'application/x-leviathan-ref'

export type DropAction =
  /** Merge `from` into the checked-out branch `into`. */
  | { kind: 'merge'; from: string; into: string }
  /** Rebase the checked-out branch `branch` onto `onto`. */
  | { kind: 'rebase'; branch: string; onto: string }
  /** Check out the local branch `into`, then merge `from` into it. */
  | { kind: 'checkoutMerge'; from: string; into: string }

/** What can be done when `source` is dropped onto `target` (`current` = checked-out branch). */
export function dropActions(source: GitRef, target: GitRef, current: string | null): DropAction[] {
  if (source.fullName === target.fullName) return []
  const isCurrent = (ref: GitRef) => ref.type === 'head' && ref.name === current
  if (isCurrent(target)) {
    return [
      { kind: 'merge', from: source.name, into: target.name },
      { kind: 'rebase', branch: target.name, onto: source.name }
    ]
  }
  if (isCurrent(source)) {
    const actions: DropAction[] = [{ kind: 'rebase', branch: source.name, onto: target.name }]
    if (target.type === 'head') actions.push({ kind: 'checkoutMerge', from: source.name, into: target.name })
    return actions
  }
  if (target.type === 'head') return [{ kind: 'checkoutMerge', from: source.name, into: target.name }]
  return []
}
