// 파일 찾기 검색.
// - 기본: 간단한 퍼지 검색. 글자가 순서대로 들어 있으면 맞음. 파일 이름에서 맞을수록, 붙어 있을수록 점수가 높다
// - *, ?가 있으면 와일드카드(like) 검색: 이클립스 Open Resource(Ctrl+Shift+R)처럼 파일 이름에 맞추고, 끝에는 *가 붙은 것으로 본다.
//   '/'가 있으면 경로(폴더 경계부터)에 맞춘다

export function fuzzyScore(query: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const p = path.toLowerCase()
  const nameStart = p.lastIndexOf('/') + 1
  // 파일 이름에 그대로 들어 있으면 가장 높게
  const inName = p.indexOf(q, nameStart)
  if (inName !== -1) return 1000 - (inName - nameStart) * 2 - (p.length - nameStart)
  const inPath = p.indexOf(q)
  if (inPath !== -1) return 600 - inPath
  let score = 0
  let pi = 0
  let streak = 0
  for (const ch of q) {
    const found = p.indexOf(ch, pi)
    if (found === -1) return null
    streak = found === pi ? streak + 1 : 0
    score += 10 + streak * 5 + (found >= nameStart ? 5 : 0)
    pi = found + 1
  }
  return score - p.length * 0.1
}

/** 와일드카드(*, ?) 검색어인지 */
export const isWildcard = (query: string) => /[*?]/.test(query)

/** 와일드카드 검색어 → 정규식. 경로 검색이면 path: true */
export function wildcardPattern(query: string): { re: RegExp; path: boolean } {
  const q = query.trim().replace(/\s+/g, '').replace(/\\/g, '/')
  let src = ''
  for (const ch of q) src += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const path = q.includes('/')
  // 끝은 열어 둔다 (이클립스처럼 "edu"는 "edu…"로 시작하는 이름)
  return { re: new RegExp(path ? `(?:^|/)${src.replace(/^\//, '')}` : `^${src}`, 'i'), path }
}

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** 검색 결과 (앞에서 limit개)와 맞는 파일 수 */
export function searchFiles(query: string, paths: string[], limit = 200): { list: string[]; total: number } {
  if (!query.trim()) return { list: paths.slice(0, limit), total: paths.length }
  if (isWildcard(query)) {
    const { re, path } = wildcardPattern(query)
    const hits = paths.filter((p) => re.test(path ? p : nameOf(p)))
    // 이름이 짧을수록(검색어에 가까울수록) 먼저
    hits.sort((a, b) => nameOf(a).length - nameOf(b).length || a.localeCompare(b))
    return { list: hits.slice(0, limit), total: hits.length }
  }
  const scored: [number, string][] = []
  for (const p of paths) {
    const s = fuzzyScore(query, p)
    if (s !== null) scored.push([s, p])
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
  return { list: scored.slice(0, limit).map((x) => x[1]), total: scored.length }
}

export function fuzzyFilter(query: string, paths: string[], limit = 200): string[] {
  return searchFiles(query, paths, limit).list
}
