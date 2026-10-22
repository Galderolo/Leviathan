/** Submodules declared in `.gitmodules`: output of `git config -z -f .gitmodules --get-regexp …`. */
export function parseSubmoduleConfig(out: string): { name: string; path: string; url: string }[] {
  const byName = new Map<string, { name: string; path: string; url: string }>()
  for (const entry of out.split('\0')) {
    const newline = entry.indexOf('\n')
    if (newline < 0) continue
    // The name is a config subsection: it keeps its case and may hold dots and spaces.
    const key = /^submodule\.(.+)\.(path|url)$/.exec(entry.slice(0, newline))
    if (!key) continue
    const sub = byName.get(key[1]) ?? { name: key[1], path: '', url: '' }
    sub[key[2] as 'path' | 'url'] = entry.slice(newline + 1)
    byName.set(key[1], sub)
  }
  return [...byName.values()].filter((s) => s.path)
}

/** Submodule entries of the index (`git ls-files -s -z`): the commit recorded for each, and whether it is in conflict. */
export function parseGitlinks(out: string): Map<string, { hash: string; conflict: boolean }> {
  const links = new Map<string, { hash: string; conflict: boolean }>()
  for (const entry of out.split('\0')) {
    const tab = entry.indexOf('\t')
    if (tab < 0) continue
    const [mode, hash, stage] = entry.slice(0, tab).split(' ')
    if (mode !== '160000') continue
    const path = entry.slice(tab + 1)
    const known = links.get(path)
    if (stage === '0') links.set(path, { hash, conflict: false })
    // In a conflict, "ours" (stage 2) is the commit the branch had.
    else links.set(path, { hash: stage === '2' || !known ? hash : known.hash, conflict: true })
  }
  return links
}
