// 내용으로 찾기(Ctrl+H) 화면 쪽 도우미: 결과 줄에서 맞은 곳 칠하기, 파일 마스크 (미리보기 백엔드도 쓴다).
// 실제 검색은 백엔드의 git grep. 단어 단위는 git -w처럼 ASCII 글자·숫자·_ 경계로 본다
import type { GrepQuery } from './types'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 검색어 → 맞은 곳을 찾는 정규식 (g). 정규식이 틀렸거나 비었으면 null */
export function grepRegex(q: GrepQuery): RegExp | null {
  if (!q.text.trim()) return null
  let src = q.regex ? q.text : esc(q.text)
  if (q.wholeWord) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`
  try {
    return new RegExp(src, q.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

/** 줄을 맞은 곳과 아닌 곳의 조각으로 */
export function splitMatches(text: string, re: RegExp | null): { t: string; hit: boolean }[] {
  if (!re) return [{ t: text, hit: false }]
  const parts: { t: string; hit: boolean }[] = []
  let at = 0
  re.lastIndex = 0
  for (let m = re.exec(text); m && parts.length < 200; m = re.exec(text)) {
    if (!m[0].length) {
      re.lastIndex++
      continue
    }
    if (m.index > at) parts.push({ t: text.slice(at, m.index), hit: false })
    parts.push({ t: m[0], hit: true })
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push({ t: text.slice(at), hit: false })
  return parts
}

/** 파일 마스크(`*.java, !*.min.js`)에 맞는 경로인지 (백엔드의 pathspec과 같은 뜻) */
export function maskMatches(mask: string, path: string): boolean {
  const pats = mask
    .split(/[,;]/)
    .map((p) => p.trim().replace(/\\/g, '/'))
    .filter((p) => p && p !== '*' && p !== '*.*' && p !== '!')
  const glob = (p: string) => {
    const src = p
      .replace(/^\//, '')
      .split('')
      .map((ch) => (ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : esc(ch)))
      .join('')
      .replace(/\[\^\/\]\*\[\^\/\]\*/g, '.*')
    return new RegExp(p.includes('/') ? `^${src}$` : `(?:^|/)${src}$`, 'i')
  }
  const inc = pats.filter((p) => !p.startsWith('!')).map(glob)
  const exc = pats.filter((p) => p.startsWith('!')).map((p) => glob(p.slice(1).trim()))
  return (!inc.length || inc.some((r) => r.test(path))) && !exc.some((r) => r.test(path))
}
