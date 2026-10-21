/** A run of unconflicted lines, or one conflict block. Lines keep their line endings. */
export type Segment =
  | { kind: 'common'; lines: string[] }
  | {
      kind: 'conflict'
      ours: string[]
      /** Only present with diff3-style markers (`|||||||`). */
      base: string[] | null
      theirs: string[]
      oursLabel: string
      theirsLabel: string
    }

export type Choice = 'ours' | 'theirs' | 'ours-theirs' | 'theirs-ours' | null

function bare(line: string): string {
  return line.replace(/\r?\n$/, '')
}

function isMarker(line: string, char: '<' | '|' | '=' | '>'): boolean {
  const text = bare(line)
  const marker = char.repeat(7)
  return char === '=' ? text === marker : text === marker || text.startsWith(marker + ' ')
}

function label(line: string): string {
  return bare(line).slice(8).trim()
}

/** Splits a file with git conflict markers into common text and conflict blocks. */
export function parseConflicts(text: string): Segment[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const segments: Segment[] = []
  let common: string[] = []
  let block: {
    ours: string[]
    base: string[] | null
    theirs: string[]
    oursLabel: string
    stage: 'ours' | 'base' | 'theirs'
    raw: string[]
  } | null = null

  const flushCommon = () => {
    if (common.length) segments.push({ kind: 'common', lines: common })
    common = []
  }

  for (const line of lines) {
    if (!block) {
      if (isMarker(line, '<')) {
        flushCommon()
        block = { ours: [], base: null, theirs: [], oursLabel: label(line), stage: 'ours', raw: [line] }
      } else common.push(line)
      continue
    }
    block.raw.push(line)
    if (block.stage === 'ours' && isMarker(line, '|')) {
      block.base = []
      block.stage = 'base'
    } else if (block.stage !== 'theirs' && isMarker(line, '=')) {
      block.stage = 'theirs'
    } else if (block.stage === 'theirs' && isMarker(line, '>')) {
      const { ours, base, theirs, oursLabel } = block
      segments.push({ kind: 'conflict', ours, base, theirs, oursLabel, theirsLabel: label(line) })
      block = null
    } else {
      ;(block.stage === 'ours' ? block.ours : block.stage === 'base' ? block.base! : block.theirs).push(line)
    }
  }
  // An unterminated block is not a conflict: keep its text untouched.
  if (block) common.push(...block.raw)
  flushCommon()
  return segments
}

export function conflictCount(segments: Segment[]): number {
  return segments.filter((s) => s.kind === 'conflict').length
}

/** The resolved file, or null while some conflict has no choice yet. */
export function resolveConflicts(segments: Segment[], choices: Choice[]): string | null {
  let out = ''
  let index = 0
  for (const segment of segments) {
    if (segment.kind === 'common') {
      out += segment.lines.join('')
      continue
    }
    const choice = choices[index++] ?? null
    if (!choice) return null
    const ours = segment.ours.join('')
    const theirs = segment.theirs.join('')
    out +=
      choice === 'ours' ? ours : choice === 'theirs' ? theirs : choice === 'ours-theirs' ? ours + theirs : theirs + ours
  }
  return out
}
