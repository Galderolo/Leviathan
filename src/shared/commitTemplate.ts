/** A commit message to start from: its first line, and the rest. */
export interface CommitDraftText {
  summary: string
  body: string
}

/**
 * git's commit.template as the commit box takes it: without the comment lines (git strips them too), its first line
 * as the summary and the rest as the description. Null when nothing but comments is left.
 */
export function parseCommitTemplate(text: string): CommitDraftText | null {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
  if (!lines.some((line) => line.trim())) return null
  const [summary, ...rest] = lines
  return { summary, body: rest.join('\n').trim() }
}
