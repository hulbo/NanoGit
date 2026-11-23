// unified diff 해석과 화면용 변환 (통합 보기·나란히 보기·바뀐 부분 강조)
import type { Tok } from './highlight'

export type LineKind = 'ctx' | 'add' | 'del' | 'hunk' | 'meta' | 'nonl'

export interface DiffLine {
  kind: LineKind
  text: string
  old: number | null
  new: number | null
  /** 구문 강조 조각 (highlightDiff가 채운다) */
  toks?: Tok[]
}

export interface Hunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffFile {
  oldPath: string | null
  newPath: string | null
  meta: string[]
  binary: boolean
  hunks: Hunk[]
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

function stripPath(p: string): string | null {
  const t = p.replace(/\t$/, '').trim()
  if (t === '/dev/null') return null
  if (t.startsWith('a/') || t.startsWith('b/')) return t.slice(2)
  return t
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: Hunk | null = null
  let oldNo = 0
  let newNo = 0
  const lines = text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const startFile = () => {
    file = { oldPath: null, newPath: null, meta: [], binary: false, hunks: [] }
    files.push(file)
    hunk = null
  }

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      startFile()
      file!.meta.push(line)
      continue
    }
    if (!file) startFile()
    const f = file!
    if (!hunk) {
      const m = HUNK_RE.exec(line)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
        hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] }
        f.hunks.push(hunk)
        continue
      }
      if (line.startsWith('--- ')) f.oldPath = stripPath(line.slice(4))
      else if (line.startsWith('+++ ')) f.newPath = stripPath(line.slice(4))
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') f.binary = true
      else if (line.startsWith('rename from ')) f.oldPath = line.slice(12)
      else if (line.startsWith('rename to ')) f.newPath = line.slice(10)
      f.meta.push(line)
      continue
    }
    const h: Hunk = hunk
    const m = HUNK_RE.exec(line)
    if (m) {
      oldNo = Number(m[1])
      newNo = Number(m[2])
      hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] }
      f.hunks.push(hunk)
      continue
    }
    const ch = line[0]
    if (ch === '+') h.lines.push({ kind: 'add', text: line.slice(1), old: null, new: newNo++ })
    else if (ch === '-') h.lines.push({ kind: 'del', text: line.slice(1), old: oldNo++, new: null })
    else if (ch === '\\') h.lines.push({ kind: 'nonl', text: line, old: null, new: null })
    else if (ch === ' ' || line === '') h.lines.push({ kind: 'ctx', text: line.slice(1), old: oldNo++, new: newNo++ })
    else {
      // 다음 파일 머리 (diff --git 없이 이어지는 경우는 거의 없지만 안전하게)
      hunk = null
      f.meta.push(line)
    }
  }
  return files
}

export interface DiffStats {
  additions: number
  deletions: number
}

export function diffStats(files: DiffFile[]): DiffStats {
  let additions = 0
  let deletions = 0
  for (const f of files)
    for (const h of f.hunks)
      for (const l of h.lines) {
        if (l.kind === 'add') additions++
        else if (l.kind === 'del') deletions++
      }
  return { additions, deletions }
}

/** 두 줄에서 바뀐 가운데 부분 (공통 앞·뒤를 뺀 범위) */
export function changedRange(a: string, b: string): { a: [number, number]; b: [number, number] } | null {
  if (a === b) return null
  let s = 0
  const max = Math.min(a.length, b.length)
  while (s < max && a[s] === b[s]) s++
  let ea = a.length
  let eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--
    eb--
  }
  // 거의 전부 다르면 강조하지 않는다 (줄 색으로 충분)
  if (s === 0 && ea === a.length && eb === b.length) return null
  return { a: [s, ea], b: [s, eb] }
}

/** 통합 보기의 한 행 */
export interface UnifiedRow {
  kind: LineKind | 'file'
  text: string
  old: number | null
  new: number | null
  /** 바뀐 부분 강조 [시작, 끝) */
  mark?: [number, number]
  toks?: Tok[]
  file?: number
  hunk?: number
}

/** 삭제 줄 묶음과 바로 이어지는 추가 줄 묶음을 짝지어 바뀐 부분을 표시한다 */
function pairMarks(lines: DiffLine[]): Map<number, [number, number]> {
  const marks = new Map<number, [number, number]>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== 'del') {
      i++
      continue
    }
    const dStart = i
    while (i < lines.length && lines[i].kind === 'del') i++
    const aStart = i
    while (i < lines.length && lines[i].kind === 'add') i++
    const n = Math.min(aStart - dStart, i - aStart)
    for (let k = 0; k < n; k++) {
      const r = changedRange(lines[dStart + k].text, lines[aStart + k].text)
      if (r) {
        marks.set(dStart + k, r.a)
        marks.set(aStart + k, r.b)
      }
    }
  }
  return marks
}

export function unifiedRows(files: DiffFile[], withFileHeaders: boolean): UnifiedRow[] {
  const rows: UnifiedRow[] = []
  files.forEach((f, fi) => {
    if (withFileHeaders) rows.push({ kind: 'file', text: f.newPath ?? f.oldPath ?? '', old: null, new: null, file: fi })
    f.hunks.forEach((h, hi) => {
      rows.push({ kind: 'hunk', text: h.header, old: null, new: null, file: fi, hunk: hi })
      const marks = pairMarks(h.lines)
      h.lines.forEach((l, li) => rows.push({ kind: l.kind, text: l.text, old: l.old, new: l.new, mark: marks.get(li), toks: l.toks }))
    })
  })
  return rows
}

export interface SideCell {
  kind: LineKind
  text: string
  no: number | null
  mark?: [number, number]
  toks?: Tok[]
}

export interface SplitRow {
  hunk?: string
  left: SideCell | null
  right: SideCell | null
}

/** 나란히 보기: 삭제 묶음은 왼쪽, 추가 묶음은 오른쪽에 같은 줄로 맞춘다 */
export function splitRows(files: DiffFile[]): SplitRow[] {
  const rows: SplitRow[] = []
  for (const f of files) {
    for (const h of f.hunks) {
      rows.push({ hunk: h.header, left: null, right: null })
      const marks = pairMarks(h.lines)
      const L = h.lines
      let i = 0
      while (i < L.length) {
        const l = L[i]
        if (l.kind === 'del' || l.kind === 'add') {
          const dels: number[] = []
          const adds: number[] = []
          while (i < L.length && L[i].kind === 'del') dels.push(i++)
          while (i < L.length && L[i].kind === 'add') adds.push(i++)
          const n = Math.max(dels.length, adds.length)
          for (let k = 0; k < n; k++) {
            const d = dels[k]
            const a = adds[k]
            rows.push({
              left: d === undefined ? null : { kind: 'del', text: L[d].text, no: L[d].old, mark: marks.get(d), toks: L[d].toks },
              right: a === undefined ? null : { kind: 'add', text: L[a].text, no: L[a].new, mark: marks.get(a), toks: L[a].toks },
            })
          }
          continue
        }
        if (l.kind === 'nonl') {
          i++
          continue
        }
        rows.push({ left: { kind: 'ctx', text: l.text, no: l.old, toks: l.toks }, right: { kind: 'ctx', text: l.text, no: l.new, toks: l.toks } })
        i++
      }
    }
  }
  return rows
}
