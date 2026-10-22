/** The notes of one Leviathan version. */
export interface ReleaseNote {
  /** `0.8.1` (no `v`). */
  version: string
  /** `2026-10-22`, when known. */
  date: string | null
  prerelease: boolean
  /** Markdown, as written in CHANGELOG.md. */
  body: string
  /** Release page, when the notes come from GitHub. */
  url: string | null
}

export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

const newestFirst = (notes: ReleaseNote[]) => notes.sort((a, b) => compareVersions(b.version, a.version))

/** Releases from GitHub's API (`/releases`): published ones only, without the policy links added to each. */
export function parseGithubReleases(json: unknown): ReleaseNote[] {
  if (!Array.isArray(json)) return []
  const notes: ReleaseNote[] = []
  for (const r of json as Record<string, unknown>[]) {
    if (!r || r.draft || typeof r.tag_name !== 'string') continue
    let body = typeof r.body === 'string' ? r.body.replace(/\r\n/g, '\n') : ''
    const footer = body.lastIndexOf('\n---\n')
    if (footer >= 0 && body.slice(footer).includes('Code signing policy')) body = body.slice(0, footer)
    notes.push({
      version: r.tag_name.replace(/^v/, ''),
      date: typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : null,
      prerelease: r.prerelease === true,
      body: body.trim(),
      url: typeof r.html_url === 'string' ? r.html_url : null
    })
  }
  return newestFirst(notes)
}

/** Released versions of CHANGELOG.md (`## [x.y.z] - date`), for when GitHub cannot be reached. */
export function parseChangelog(text: string): ReleaseNote[] {
  const notes: ReleaseNote[] = []
  let current: ReleaseNote | null = null
  let lines: string[] = []
  const close = () => {
    if (current) notes.push({ ...current, body: lines.join('\n').trim() })
  }
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      close()
      const m = /^## \[(\d+\.\d+\.\d+[^\]]*)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(line)
      current = m ? { version: m[1], date: m[2] ?? null, prerelease: false, body: '', url: null } : null
      lines = []
    } else if (current) lines.push(line)
  }
  close()
  return newestFirst(notes)
}

export type NoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; depth: number; text: string }
  | { kind: 'paragraph'; text: string }

/** The markdown of release notes as blocks (headings, nested list items, paragraphs), never as HTML. */
export function noteBlocks(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let open: NoteBlock | null = null
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) {
      open = null
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^(\s*)[-*]\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1].trim() })
      open = null
    } else if (item) {
      open = { kind: 'item', depth: Math.floor(item[1].length / 2), text: item[2].trim() }
      blocks.push(open)
    } else if (open) {
      // A wrapped line continues the item or paragraph above it.
      open.text += ' ' + line.trim()
    } else {
      open = { kind: 'paragraph', text: line.trim() }
      blocks.push(open)
    }
  }
  return blocks
}

export type InlineSpan =
  { kind: 'text' | 'code' | 'strong' | 'em'; text: string } | { kind: 'link'; text: string; href: string }

/** Inline markdown of a block: `code`, **strong**, *em* and [links](https://…); anything else stays plain text. */
export function inlineSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = []
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g
  let last = 0
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) spans.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[1] !== undefined) spans.push({ kind: 'code', text: m[1] })
    else if (m[2] !== undefined) spans.push({ kind: 'strong', text: m[2] })
    else if (m[3] !== undefined) spans.push({ kind: 'em', text: m[3] })
    // Only web links: anything else (javascript:, file:…) is shown as its text.
    else if (/^https?:\/\//i.test(m[5])) spans.push({ kind: 'link', text: m[4], href: m[5] })
    else spans.push({ kind: 'text', text: m[4] })
    last = m.index! + m[0].length
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) })
  return spans
}
