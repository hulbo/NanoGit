import { describe, expect, it } from 'vitest'
import { computeGraph } from './graph'

const c = (sha: string, ...parents: string[]) => ({ sha, parents })

describe('computeGraph', () => {
  it('일직선 이력은 한 레인', () => {
    const rows = computeGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0])
    expect(rows.every((r) => r.width === 1)).toBe(true)
    // 첫 커밋은 위에서 들어오는 선이 없고, 루트 커밋은 아래로 나가는 선이 없다
    expect(rows[0].segs.some((s) => s.kind === 'in')).toBe(false)
    expect(rows[2].segs.some((s) => s.kind === 'out')).toBe(false)
  })

  it('가지와 병합', () => {
    // m = merge(b, f), f -> a, b -> a
    const rows = computeGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')])
    expect(rows[0].merge).toBe(true)
    expect(rows[0].segs.filter((s) => s.kind === 'out').map((s) => s.to)).toEqual([0, 1])
    // f는 두 번째 레인, b는 첫 레인
    expect(rows[1].col).toBe(1)
    expect(rows[2].col).toBe(0)
    // f 행에서 첫 레인은 지나가기만 한다
    expect(rows[1].segs).toContainEqual({ kind: 'pass', from: 0, to: 0, color: rows[0].color })
    // b 행에서 f 줄기(레인 1)가 왼쪽 줄기로 당겨져 합쳐지고, a는 첫 레인에 남는다
    expect(rows[2].segs).toContainEqual({ kind: 'pass', from: 1, to: 0, color: rows[1].color })
    expect(rows[3].col).toBe(0)
    expect(rows[3].width).toBe(1)
  })

  it('브랜치 끝이 여러 개면 레인이 따로 생기고, 빈 레인은 다시 쓴다', () => {
    // 두 브랜치 끝 x, y가 같은 부모 a를 가짐. 그 아래 z는 따로 시작하는 브랜치
    const rows = computeGraph([c('x', 'a'), c('y', 'a'), c('a', 'r'), c('z', 'r'), c('r')])
    expect(rows[0].col).toBe(0)
    expect(rows[1].col).toBe(1)
    // y의 첫 부모 a는 이미 레인 0이 기다리므로 레인 0으로 합쳐진다
    expect(rows[1].segs).toContainEqual({ kind: 'out', from: 1, to: 0, color: rows[1].color })
    // 레인 1이 비었으므로 z가 다시 쓴다
    expect(rows[3].col).toBe(1)
  })
})
