// 구문 강조: 파일 종류에 맞게 줄마다 색 조각(Tok)으로 나눈다.
// highlight.js의 결과(HTML)를 줄 단위 조각으로 풀어, 화면에 보이는 줄만 그리는 보기에서 쓴다
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import dos from 'highlight.js/lib/languages/dos'
import go from 'highlight.js/lib/languages/go'
import gradle from 'highlight.js/lib/languages/gradle'
import groovy from 'highlight.js/lib/languages/groovy'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import properties from 'highlight.js/lib/languages/properties'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { DiffFile } from './diff'

const LANGS = { bash, c, cpp, csharp, css, diff, dockerfile, dos, go, gradle, groovy, ini, java, javascript, json, kotlin, less, makefile, markdown, php, powershell, properties, python, rust, scss, sql, typescript, xml, yaml }
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)
// MyBatis 매퍼 안의 SQL: #{값}, ${값}을 따로 표시
hljs.registerLanguage('mbsql', (h) => {
  const d = sql(h)
  return { ...d, name: 'MyBatis SQL', contains: [{ scope: 'template-variable', begin: /[#$]\{/, end: /\}/ }, ...(d.contains ?? [])] }
})

/** 한 줄 안의 색 조각. c는 CSS 클래스 ('' = 기본 글자색) */
export interface Tok {
  t: string
  c: string
}

/** 이보다 크면 강조하지 않는다 (느려지지 않게) */
const MAX_CHARS = 600_000

const BY_EXT: Record<string, string> = {
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  groovy: 'groovy',
  gradle: 'gradle',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  svelte: 'xml',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  jsp: 'xml',
  xml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  svg: 'xml',
  tld: 'xml',
  wsdl: 'xml',
  fxml: 'xml',
  plist: 'xml',
  csproj: 'xml',
  vbproj: 'xml',
  props: 'xml',
  targets: 'xml',
  resx: 'xml',
  config: 'xml',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  map: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  properties: 'properties',
  env: 'properties',
  ini: 'ini',
  toml: 'ini',
  cfg: 'ini',
  conf: 'ini',
  editorconfig: 'ini',
  sql: 'sql',
  ddl: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  bat: 'dos',
  cmd: 'dos',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  py: 'python',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  php: 'php',
  diff: 'diff',
  patch: 'diff',
}

const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  jenkinsfile: 'groovy',
  '.gitconfig': 'ini',
  '.npmrc': 'ini',
}

/** MyBatis·iBATIS 매퍼 XML인지 (내용 일부로 판단) */
const MAPPER_RE = /<!DOCTYPE\s+(mapper|sqlMap)\b|<(mapper|sqlMap)[\s>]|#\{\w|<(select|insert|update|delete)\s+id=/

/** 파일 경로(와 내용 앞부분)로 강조할 언어를 고른다. 모르면 null */
export function languageOf(path: string | null | undefined, sample = ''): string | null {
  if (!path) return null
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  let lang = BY_NAME[name] ?? null
  if (!lang && name.startsWith('dockerfile')) lang = 'dockerfile'
  if (!lang && name.startsWith('.env')) lang = 'properties'
  if (!lang) {
    const dot = name.lastIndexOf('.')
    if (dot >= 0) lang = BY_EXT[name.slice(dot + 1)] ?? null
  }
  if (lang === 'xml' && /\.xml$/.test(name) && MAPPER_RE.test(sample)) return 'mybatis'
  return lang
}

/** 강조 클래스를 몇 가지 색으로 줄인다 (CSS는 app.css의 .hl-*) */
function classOf(scope: string, lang: string): string {
  const [head, ...mods] = scope.split(' ')
  const s = head.replace(/^hljs-/, '')
  if (s === 'attr') {
    if (lang === 'yaml' || lang === 'properties' || lang === 'ini') return 'hl-k'
    if (lang === 'json') return 'hl-p'
    return 'hl-a'
  }
  if (lang === 'java' && s === 'built_in') return 'hl-k'
  if (lang === 'java' && s === 'variable') return ''
  if (s === 'title') return mods.includes('function_') && !mods.includes('invoke__') ? 'hl-f' : ''
  if (s === 'variable') return mods.includes('language_') ? 'hl-k' : 'hl-p'
  switch (s) {
    case 'keyword':
    case 'literal':
    case 'type':
    case 'selector-tag':
    case 'template-tag':
    case 'bullet':
      return 'hl-k'
    case 'string':
    case 'regexp':
    case 'char':
    case 'code':
    case 'link':
      return 'hl-s'
    case 'number':
      return 'hl-n'
    case 'comment':
    case 'quote':
      return 'hl-c'
    case 'doctag':
      return 'hl-d'
    case 'meta':
      return 'hl-m'
    case 'tag':
    case 'name':
    case 'selector-class':
    case 'selector-id':
    case 'selector-pseudo':
    case 'selector-attr':
      return 'hl-t'
    case 'property':
    case 'attribute':
    case 'template-variable':
      return 'hl-p'
    case 'built_in':
    case 'symbol':
      return 'hl-b'
    case 'section':
      return 'hl-h'
    case 'emphasis':
      return 'hl-em'
    case 'strong':
      return 'hl-strong'
    case 'addition':
      return 'hl-add'
    case 'deletion':
      return 'hl-del'
    default:
      return ''
  }
}

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const decode = (s: string) => (s.includes('&') ? s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITY[e]) : s)

function push(toks: Tok[], t: string, c: string) {
  if (!t) return
  const last = toks[toks.length - 1]
  if (last && last.c === c) last.t += t
  else toks.push({ t, c })
}

/** highlight.js의 HTML을 조각으로 (줄바꿈은 글자 그대로 남긴다). 겹친 span은 가장 안쪽 것만 쓴다 */
function toTokens(html: string, lang: string): Tok[] {
  const out: Tok[] = []
  const stack: string[] = []
  for (const m of html.matchAll(/<span class="([^"]*)">|<\/span>|[^<]+/g)) {
    if (m[1] !== undefined) stack.push(classOf(m[1], lang))
    else if (m[0] === '</span>') stack.pop()
    else push(out, decode(m[0]), stack[stack.length - 1] ?? '')
  }
  return out
}

function run(code: string, lang: string): Tok[] {
  return toTokens(hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang)
}

/** 매퍼 XML: 태그 사이 글자(= SQL)를 SQL로 한 번 더 강조한다 */
function mybatis(code: string): Tok[] {
  const out: Tok[] = []
  for (const tk of run(code, 'xml')) {
    if (tk.c || !/[A-Za-z#$]/.test(tk.t)) {
      push(out, tk.t, tk.c)
      continue
    }
    for (const piece of tk.t.split(/(<!\[CDATA\[|\]\]>)/)) {
      if (piece === '<![CDATA[' || piece === ']]>') push(out, piece, 'hl-m')
      else for (const s of run(piece, 'mbsql')) push(out, s.t, s.c)
    }
  }
  return out
}

/** 조각들을 줄로 나눈다 */
function splitLines(toks: Tok[]): Tok[][] {
  const lines: Tok[][] = [[]]
  for (const tk of toks) {
    const parts = tk.t.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) lines.push([])
      push(lines[lines.length - 1], p, tk.c)
    })
  }
  return lines
}

/** 이어진 줄들을 강조한다. 강조할 수 없으면(언어 모름, 너무 큼, 오류) null */
export function highlightLines(lines: string[], lang: string | null): Tok[][] | null {
  if (!lang || !lines.length) return null
  const code = lines.join('\n')
  if (code.length > MAX_CHARS) return null
  try {
    const out = splitLines(lang === 'mybatis' ? mybatis(code) : run(code, lang))
    while (out.length < lines.length) out.push([])
    return out.slice(0, lines.length)
  } catch {
    return null
  }
}

/** diff의 줄마다 조각을 붙인다 (헝크마다 옛 쪽·새 쪽을 따로 강조). 경로로 언어를 고른다 */
export function highlightDiff(files: DiffFile[]) {
  for (const f of files) {
    if (f.binary || !f.hunks.length) continue
    const sample = f.hunks.map((h) => h.lines.map((l) => l.text).join('\n')).join('\n')
    if (sample.length > MAX_CHARS) continue
    const lang = languageOf(f.newPath ?? f.oldPath, sample)
    if (!lang) continue
    for (const h of f.hunks) {
      const olds = h.lines.filter((l) => l.kind === 'ctx' || l.kind === 'del')
      const news = h.lines.filter((l) => l.kind === 'ctx' || l.kind === 'add')
      const a = highlightLines(olds.map((l) => l.text), lang)
      const b = highlightLines(news.map((l) => l.text), lang)
      // 문맥 줄은 새 쪽 결과를 쓴다
      olds.forEach((l, i) => l.kind === 'del' && a && (l.toks = a[i]))
      news.forEach((l, i) => b && (l.toks = b[i]))
    }
  }
}

/** 조각에 바뀐 부분 [시작, 끝) 표시를 입힌다 (m = 표시 안) */
export function withMark(toks: Tok[], mark: [number, number] | undefined): (Tok & { m?: boolean })[] {
  if (!mark) return toks
  const [s, e] = mark
  const out: (Tok & { m?: boolean })[] = []
  let pos = 0
  for (const tk of toks) {
    const end = pos + tk.t.length
    const cuts = [pos, Math.min(Math.max(s, pos), end), Math.min(Math.max(e, pos), end), end]
    for (let i = 0; i < 3; i++) {
      const t = tk.t.slice(cuts[i] - pos, cuts[i + 1] - pos)
      if (t) out.push({ t, c: tk.c, m: i === 1 })
    }
    pos = end
  }
  return out
}
