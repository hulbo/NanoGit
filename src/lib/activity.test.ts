import { describe as group, expect, it } from 'vitest'
import { describe, groupActivity, matchesFilter, newSince } from './activity'
import type { ActivityEntry } from './types'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const Z = '0'.repeat(40)

const entry = (p: Partial<ActivityEntry>): ActivityEntry => ({
  time: 100,
  refName: 'refs/heads/main',
  old: A,
  new: B,
  message: '',
  who: '홍길동',
  subject: '로그인 수정',
  oldSubject: '이전 커밋',
  dropped: 0,
  ...p,
})

group('describe', () => {
  it('커밋과 amend', () => {
    expect(describe(entry({ message: 'commit: 로그인 수정' }))).toMatchObject({ kind: 'commit', title: '로그인 수정', severity: 'normal', ref: 'main' })
    const amend = describe(entry({ message: 'commit (amend): 로그인 수정', dropped: 1 }))
    expect(amend.kind).toBe('amend')
    expect(amend.severity).toBe('caution')
    expect(amend.note).toContain('이전 커밋')
  })

  it('reset으로 커밋이 버려지면 위험', () => {
    const v = describe(entry({ message: 'reset: moving to HEAD~2', dropped: 2 }))
    expect(v.severity).toBe('danger')
    expect(v.note).toContain('커밋 2개')
    expect(describe(entry({ message: 'reset: moving to HEAD' })).severity).toBe('caution')
  })

  it('push와 강제 push', () => {
    const push = describe(entry({ refName: 'refs/remotes/origin/main', message: 'update by push' }))
    expect(push).toMatchObject({ kind: 'push', label: 'push', ref: 'origin/main', severity: 'normal' })
    const forced = describe(entry({ refName: 'refs/remotes/origin/main', message: 'update by push', dropped: 3 }))
    expect(forced).toMatchObject({ label: '강제 push', severity: 'danger' })
    expect(describe(entry({ refName: 'refs/remotes/origin/x', message: 'update by push', old: Z })).note).toBe('원격에 새 브랜치')
  })

  it('fetch forced-update', () => {
    const v = describe(entry({ refName: 'refs/remotes/origin/main', message: 'fetch: forced-update' }))
    expect(v).toMatchObject({ kind: 'fetch', severity: 'caution' })
  })

  it('전환: 브랜치·분리된 HEAD', () => {
    expect(describe(entry({ refName: 'HEAD', message: 'checkout: moving from main to feature/x' }))).toMatchObject({ kind: 'checkout', title: 'main → feature/x', severity: 'normal' })
    const det = describe(entry({ refName: 'HEAD', message: `checkout: moving from main to ${A}` }))
    expect(det.severity).toBe('caution')
    expect(det.note).toContain('분리된 HEAD')
  })

  it('병합·rebase·브랜치', () => {
    expect(describe(entry({ message: 'merge feature/api: Fast-forward' })).title).toBe('feature/api → main (fast-forward)')
    expect(describe(entry({ message: 'rebase (finish): returning to refs/heads/main' }))).toMatchObject({ kind: 'rebase', severity: 'caution' })
    expect(describe(entry({ message: 'branch: Created from HEAD', old: Z }))).toMatchObject({ kind: 'branch', title: 'main (HEAD에서)' })
    expect(describe(entry({ message: 'Branch: renamed refs/heads/a to refs/heads/b' })).title).toBe('a → b')
  })
})

group('묶기·걸러내기', () => {
  it('이어진 rebase 단계는 하나로', () => {
    const items = groupActivity([
      entry({ message: 'rebase (finish): returning to refs/heads/main' }),
      entry({ message: 'rebase (pick): 하나' }),
      entry({ message: 'rebase (start): checkout origin/main' }),
      entry({ message: 'commit: 둘' }),
    ])
    expect(items).toHaveLength(2)
    expect(items[0].steps).toBe(3)
  })

  it('필터', () => {
    const push = describe(entry({ refName: 'refs/remotes/origin/main', message: 'update by push' }))
    expect(matchesFilter(push, 'remote')).toBe(true)
    expect(matchesFilter(push, 'commit')).toBe(false)
    expect(matchesFilter(describe(entry({ message: 'reset: moving to HEAD~1', dropped: 1 })), 'warn')).toBe(true)
  })

  it('새 항목 찾기', () => {
    const old = entry({ time: 100, message: 'commit: 하나' })
    const n1 = entry({ time: 120, message: 'commit: 둘', new: 'c'.repeat(40) })
    expect(newSince([n1, old], old)).toEqual([n1])
    expect(newSince([old], old)).toEqual([])
    expect(newSince([n1, old], null)).toEqual([])
  })
})
