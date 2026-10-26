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
      /** The block as it is in the file, markers included. */
      raw: string[]
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
      const { ours, base, theirs, oursLabel, raw } = block
      segments.push({ kind: 'conflict', ours, base, theirs, oursLabel, theirsLabel: label(line), raw })
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

/** The text a block becomes with `choice`; null without one. */
function chosen(segment: Extract<Segment, { kind: 'conflict' }>, choice: Choice): string | null {
  if (!choice) return null
  const ours = segment.ours.join('')
  const theirs = segment.theirs.join('')
  return choice === 'ours'
    ? ours
    : choice === 'theirs'
      ? theirs
      : choice === 'ours-theirs'
        ? ours + theirs
        : theirs + ours
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
    const text = chosen(segment, choices[index++] ?? null)
    if (text === null) return null
    out += text
  }
  return out
}

/** The file to edit by hand: each block with a choice resolved, the others as they are, markers and all. */
export function draftConflicts(segments: Segment[], choices: Choice[]): string {
  let index = 0
  return segments
    .map((segment) =>
      segment.kind === 'common'
        ? segment.lines.join('')
        : (chosen(segment, choices[index++] ?? null) ?? segment.raw.join(''))
    )
    .join('')
}

/** The line ending most of the text's lines have (LF when there is none). */
export function lineEnding(text: string): '\r\n' | '\n' {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return crlf > lf ? '\r\n' : '\n'
}

/** `text` with every line ending as `eol` (a text box gives back LF only). */
export function withLineEnding(text: string, eol: '\r\n' | '\n'): string {
  const lf = text.replace(/\r\n/g, '\n')
  return eol === '\n' ? lf : lf.replace(/\n/g, '\r\n')
}
