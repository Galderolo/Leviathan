import type { Commit, GitRef, HeadInfo } from '../../shared/types'

export interface StartOption {
  value: string
  label: string
}

/**
 * Choices for "start from" when creating a branch: the current HEAD, every
 * other branch, remote branch and tag, plus the picked commit when it is not
 * already one of those. `value` is the preselected choice.
 */
export function branchStartOptions(
  head: HeadInfo,
  refs: GitRef[],
  commits: Commit[],
  startHash: string | null
): { options: StartOption[]; value: string } {
  const short = (hash: string | null) => (hash ?? '').slice(0, 7)
  const headOption: StartOption = {
    value: 'HEAD',
    label: head.branch ? `${head.branch} (HEAD)` : `HEAD (${short(head.hash)})`
  }
  const named = [
    ...refs.filter((r) => r.type === 'head' && r.name !== head.branch),
    ...refs.filter((r) => r.type === 'remote'),
    ...refs.filter((r) => r.type === 'tag')
  ]
  const options = [headOption, ...named.map((r) => ({ value: r.name, label: r.name }))]

  if (!startHash || startHash === head.hash) return { options, value: 'HEAD' }
  const tip = named.find((r) => r.hash === startHash)
  if (tip) return { options, value: tip.name }

  const subject = commits.find((c) => c.hash === startHash)?.subject
  const commitOption = { value: startHash, label: subject ? `${short(startHash)} — ${subject}` : short(startHash) }
  return { options: [commitOption, ...options], value: startHash }
}
