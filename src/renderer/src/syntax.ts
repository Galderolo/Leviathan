import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import glsl from 'highlight.js/lib/languages/glsl'
import go from 'highlight.js/lib/languages/go'
import groovy from 'highlight.js/lib/languages/groovy'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import objectivec from 'highlight.js/lib/languages/objectivec'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import properties from 'highlight.js/lib/languages/properties'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { htmlToLines, languageFor, type SyntaxToken } from '../../shared/syntax'
import type { DiffHunk } from '../../shared/types'

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  glsl,
  go,
  groovy,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  objectivec,
  php,
  powershell,
  properties,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml
}
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language)

// Beyond these, a hunk is drawn plain: highlighting it would make the diff slow to open.
const MAX_LINE_CHARS = 2000
const MAX_HUNK_CHARS = 100_000
const MAX_DIFF_CHARS = 300_000

/**
 * The syntax tokens of each line of a hunk, by line index. Each side (old: context and removed lines; new: context
 * and added lines) is highlighted as one piece of code, so a comment or string spanning lines stays one.
 */
export function highlightHunk(hunk: DiffHunk, language: string | null): Map<number, SyntaxToken[]> | null {
  if (!language || !hljs.getLanguage(language)) return null
  let chars = 0
  for (const line of hunk.lines) {
    if (line.text.length > MAX_LINE_CHARS) return null
    chars += line.text.length
  }
  if (chars > MAX_HUNK_CHARS) return null
  const old: number[] = []
  const now: number[] = []
  hunk.lines.forEach((line, i) => {
    if (line.type === 'meta') return
    if (line.type !== 'add') old.push(i)
    if (line.type !== 'del') now.push(i)
  })
  const tokens = new Map<number, SyntaxToken[]>()
  for (const [side, indexes] of [
    ['old', old],
    ['new', now]
  ] as const) {
    const code = indexes.map((i) => hunk.lines[i].text).join('\n')
    const lines = htmlToLines(hljs.highlight(code, { language, ignoreIllegals: true }).value)
    indexes.forEach((index, k) => {
      // Context lines take their new version.
      if (side === 'old' && hunk.lines[index].type === 'ctx') return
      tokens.set(index, lines[k] ?? [])
    })
  }
  return tokens
}

/** The syntax tokens of every hunk of a file's diff (null entries for hunks drawn plain). */
export function highlightHunks(hunks: DiffHunk[], path: string): (Map<number, SyntaxToken[]> | null)[] {
  const language = languageFor(path)
  let chars = 0
  return hunks.map((hunk) => {
    chars += hunk.lines.reduce((n, line) => n + line.text.length, 0)
    return chars > MAX_DIFF_CHARS ? null : highlightHunk(hunk, language)
  })
}
