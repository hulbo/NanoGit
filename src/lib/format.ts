// 시간·해시·경로 표시

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-11-20 10:21 */
export function dateTime(sec: number, withSeconds = false): string {
  const d = new Date(sec * 1000)
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base
}

/** 히스토리 목록용 짧은 날짜: 오늘이면 시각, 올해면 월·일, 그 전이면 연-월-일 */
export function shortDate(sec: number, now = Date.now()): string {
  const d = new Date(sec * 1000)
  const n = new Date(now)
  if (d.toDateString() === n.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const y = new Date(now - 86400000)
  if (d.toDateString() === y.toDateString()) return `어제 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 방금, 12초 전, 5분 전, 3시간 전, 그 뒤는 shortDate */
export function relative(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 5) return '방금'
  if (s < 60) return `${s}초 전`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return shortDate(ms / 1000, now)
}

export const short = (sha: string | null | undefined, n = 7) => (sha ? sha.slice(0, n) : '')

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** 저장소 루트와 상대 경로를 합친 절대 경로 (Windows 구분자) */
export function joinPath(root: string, rel: string): string {
  const r = root.replace(/[\\/]+$/, '')
  const p = `${r}/${rel}`
  return /^[A-Za-z]:/.test(r) ? p.replace(/\//g, '\\') : p
}

/** 작성자 이름 → 아바타 색 (같은 이름은 같은 색) */
export function nameHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}

export function initial(name: string): string {
  const t = name.trim()
  return t ? [...t][0].toUpperCase() : '?'
}

export function plural(n: number, unit: string): string {
  return `${n.toLocaleString('ko-KR')}${unit}`
}

/** 파일 상태 글자 → 이름 */
export function statusName(s: string): string {
  switch (s) {
    case 'A':
      return '추가'
    case 'M':
      return '수정'
    case 'D':
      return '삭제'
    case 'R':
      return '이름 변경'
    case 'C':
      return '복사'
    case 'T':
      return '형식 변경'
    case 'U':
      return '충돌'
    case '?':
      return '추적 안 함'
    default:
      return s
  }
}
