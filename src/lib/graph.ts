// 히스토리 그래프(레인) 계산.
// 커밋을 위에서 아래로 훑으며 "이 레인이 기다리는 커밋"을 기억한다. 레인은 옮기지 않고(직선 유지),
// 비면 다음 새 가지가 다시 쓴다. 행마다 그릴 선분을 돌려준다.

export interface GraphCommit {
  sha: string
  parents: string[]
}

/**
 * 행 안의 선분.
 * - pass: 위(from) → 아래(to), 노드를 지나지 않는 레인
 * - in:   위(from) → 노드(to), 이 커밋으로 들어오는 선
 * - out:  노드(from) → 아래(to), 부모로 나가는 선
 */
export interface Seg {
  kind: 'pass' | 'in' | 'out'
  from: number
  to: number
  color: number
}

export interface GraphRow {
  /** 노드가 있는 레인 */
  col: number
  color: number
  segs: Seg[]
  /** 이 행에서 쓰는 레인 수 */
  width: number
  /** 병합 커밋 (부모 둘 이상) */
  merge: boolean
}

export const PALETTE_SIZE = 8

export function computeGraph(commits: GraphCommit[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  const rows: GraphRow[] = []

  const firstFree = () => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }

  for (const c of commits) {
    const top = lanes.slice()
    let col = lanes.indexOf(c.sha)
    const fresh = col === -1
    if (fresh) {
      col = firstFree()
      lanes[col] = c.sha
      colors[col] = nextColor++ % PALETTE_SIZE
    }
    const segs: Seg[] = []

    // 이 커밋을 기다리던 레인들이 노드로 모인다
    for (let j = 0; j < top.length; j++) {
      if (top[j] === c.sha) {
        segs.push({ kind: 'in', from: j, to: col, color: colors[j] })
        if (j !== col) lanes[j] = null
      }
    }
    // 노드를 지나지 않는 레인은 그대로 내려간다
    for (let j = 0; j < top.length; j++) {
      const s = top[j]
      if (s != null && s !== c.sha) segs.push({ kind: 'pass', from: j, to: j, color: colors[j] })
    }

    const nodeColor = colors[col]
    if (c.parents.length === 0) {
      lanes[col] = null
    } else {
      // 첫 부모는 같은 레인으로 이어진다. 이미 다른 레인이 그 부모를 기다리면 거기로 합쳐진다
      const first = c.parents[0]
      const existing = lanes.indexOf(first)
      if (existing !== -1 && existing > col) {
        // 오른쪽 레인이 같은 부모를 기다리면 그 레인을 이쪽으로 당겨 와 왼쪽 줄기를 곧게 유지한다
        lanes[col] = first
        lanes[existing] = null
        const pass = segs.find((s) => s.kind === 'pass' && s.from === existing)
        if (pass) pass.to = col
        segs.push({ kind: 'out', from: col, to: col, color: nodeColor })
      } else if (existing !== -1 && existing !== col) {
        lanes[col] = null
        segs.push({ kind: 'out', from: col, to: existing, color: nodeColor })
      } else {
        lanes[col] = first
        segs.push({ kind: 'out', from: col, to: col, color: nodeColor })
      }
      for (const p of c.parents.slice(1)) {
        let k = lanes.indexOf(p)
        if (k === -1) {
          k = firstFree()
          lanes[k] = p
          colors[k] = nextColor++ % PALETTE_SIZE
        }
        segs.push({ kind: 'out', from: col, to: k, color: colors[k] })
      }
    }

    const width = Math.max(top.length, lanes.length, col + 1)
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop()
    rows.push({ col, color: nodeColor, segs, width, merge: c.parents.length > 1 })
  }
  return rows
}
