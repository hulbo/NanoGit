// 파일 찾기용 간단한 퍼지 검색: 글자가 순서대로 들어 있으면 맞음. 파일 이름에서 맞을수록, 붙어 있을수록 점수가 높다

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

export function fuzzyFilter(query: string, paths: string[], limit = 200): string[] {
  if (!query.trim()) return paths.slice(0, limit)
  const scored: [number, string][] = []
  for (const p of paths) {
    const s = fuzzyScore(query, p)
    if (s !== null) scored.push([s, p])
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
  return scored.slice(0, limit).map((x) => x[1])
}
