import type { Span } from './wordDiff'

/** A piece of a highlighted line, with its highlight.js class ('' for plain text). */
export interface SyntaxToken {
  text: string
  cls: string
}

/** A piece of a line to draw: its syntax class, and whether it is a word that changed. */
export interface Segment {
  text: string
  cls: string
  changed: boolean
}

const BY_EXTENSION: Record<string, string> = {
  cs: 'csharp',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  jsonc: 'json',
  asmdef: 'json',
  asmref: 'json',
  inputactions: 'json',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  xaml: 'xml',
  uxml: 'xml',
  csproj: 'xml',
  props: 'xml',
  targets: 'xml',
  resx: 'xml',
  plist: 'xml',
  svg: 'xml',
  css: 'css',
  uss: 'css',
  scss: 'scss',
  less: 'less',
  yml: 'yaml',
  yaml: 'yaml',
  // Unity's text assets are YAML.
  asset: 'yaml',
  prefab: 'yaml',
  unity: 'yaml',
  mat: 'yaml',
  anim: 'yaml',
  controller: 'yaml',
  meta: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  inl: 'cpp',
  go: 'go',
  rs: 'rust',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  sql: 'sql',
  ini: 'ini',
  cfg: 'ini',
  toml: 'ini',
  lua: 'lua',
  // Shaders (Unity's HLSL included): GLSL's grammar is the closest one highlight.js has.
  shader: 'glsl',
  hlsl: 'glsl',
  hlslinc: 'glsl',
  cginc: 'glsl',
  compute: 'glsl',
  glsl: 'glsl',
  vert: 'glsl',
  frag: 'glsl',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  m: 'objectivec',
  mm: 'objectivec',
  gradle: 'groovy',
  groovy: 'groovy',
  properties: 'properties'
}

const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gemfile: 'ruby',
  rakefile: 'ruby'
}

/** The highlight.js language for a file, or null when it is not one the app highlights. */
export function languageFor(path: string): string | null {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  if (BY_NAME[name]) return BY_NAME[name]
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return BY_EXTENSION[name.slice(dot + 1)] ?? null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }

/**
 * highlight.js output (`<span class="…">` around escaped text) as lines of classed text. A token that spans lines
 * keeps its class on each of them; nested tokens take the innermost class.
 */
export function htmlToLines(html: string): SyntaxToken[][] {
  const lines: SyntaxToken[][] = [[]]
  const classes: string[] = []
  for (const part of html.match(/<span class="[^"]*">|<\/span>|[^<]+/g) ?? []) {
    if (part.startsWith('<span')) classes.push(part.slice(13, -2))
    else if (part === '</span>') classes.pop()
    else {
      const text = part.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, name: string) => ENTITIES[name])
      text.split('\n').forEach((piece, i) => {
        if (i > 0) lines.push([])
        if (piece) lines[lines.length - 1].push({ text: piece, cls: classes[classes.length - 1] ?? '' })
      })
    }
  }
  return lines
}

/**
 * A line cut wherever its syntax class or its changed-words marking changes. Tokens that do not add up to the
 * line's text are ignored, so a mismatch shows the plain text rather than a wrong one.
 */
export function mergeSegments(text: string, syntax?: SyntaxToken[], words?: Span[]): Segment[] {
  const covers = (pieces?: { text: string }[]) => !!pieces && pieces.map((p) => p.text).join('') === text
  const syn = covers(syntax) ? syntax! : [{ text, cls: '' }]
  const marks = covers(words) ? words! : [{ text, changed: false }]
  const out: Segment[] = []
  let i = 0
  let j = 0
  let inSyn = 0
  let inMark = 0
  while (i < syn.length && j < marks.length) {
    const take = Math.min(syn[i].text.length - inSyn, marks[j].text.length - inMark)
    if (take > 0) out.push({ text: syn[i].text.slice(inSyn, inSyn + take), cls: syn[i].cls, changed: marks[j].changed })
    inSyn += take
    inMark += take
    if (inSyn >= syn[i].text.length) {
      i++
      inSyn = 0
    }
    if (inMark >= marks[j].text.length) {
      j++
      inMark = 0
    }
  }
  return out
}
