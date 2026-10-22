import type { Commit, GitRef, PullRequest } from '../../shared/types'

/**
 * Open pull requests by branch (full ref name): each one sits on the remote
 * branch it comes from and on the local branch that tracks it. Pull requests
 * from forks have no branch here.
 */
export function pullRequestsByRef(prs: PullRequest[], remote: string | null, refs: GitRef[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  if (!remote) return map
  const add = (fullName: string, number: number) => map.set(fullName, [...(map.get(fullName) ?? []), number])
  for (const pr of prs) {
    if (pr.fromFork) continue
    const remoteName = `${remote}/${pr.sourceBranch}`
    for (const r of refs) {
      if ((r.type === 'remote' && r.name === remoteName) || (r.type === 'head' && r.upstream === remoteName)) {
        add(r.fullName, pr.number)
      }
    }
  }
  return map
}

/** A commit and every loaded commit it comes from (its branch's history in the graph). */
export function ancestry(commits: Commit[], tip: string): Set<string> {
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const seen = new Set<string>()
  const stack = [tip]
  while (stack.length) {
    const hash = stack.pop()!
    if (seen.has(hash)) continue
    seen.add(hash)
    for (const parent of byHash.get(hash)?.parents ?? []) if (byHash.has(parent)) stack.push(parent)
  }
  return seen
}

/** Where the highlighted branch (a full ref name) points now; null when nothing is highlighted or the branch is gone. */
export function highlightTip(highlight: string | null, refs: GitRef[]): string | null {
  if (!highlight) return null
  return refs.find((r) => r.fullName === highlight)?.hash ?? null
}
