import { describe, expect, it } from 'vitest'
import { describe as view } from './activity'
import { buildNotices, notifyGroup, type NotifyPrefs } from './notify'
import type { ActivityEntry } from './types'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

const entry = (message: string, p: Partial<ActivityEntry> = {}): ActivityEntry => ({
  time: 100,
  refName: 'refs/heads/main',
  old: A,
  new: B,
  message,
  who: 'Claude',
  subject: '로그인 수정',
  oldSubject: '이전 커밋',
  dropped: 0,
  ...p,
})

const ALL: NotifyPrefs = { notifyCommit: true, notifyPush: true, notifyBranch: true, notifyWarn: true }

describe('notifyGroup', () => {
  it('종류별 묶음', () => {
    expect(notifyGroup(view(entry('commit: 로그인 수정')))).toBe('commit')
    expect(notifyGroup(view(entry('update by push', { refName: 'refs/remotes/origin/main' })))).toBe('push')
    expect(notifyGroup(view(entry('checkout: moving from main to dev', { refName: 'HEAD' })))).toBe('branch')
    expect(notifyGroup(view(entry('reset: moving to HEAD~1', { dropped: 1 })))).toBe('warn')
    expect(notifyGroup(view(entry('commit (amend): 로그인 수정')))).toBe('warn')
    expect(notifyGroup(view(entry('fetch: fast-forward', { refName: 'refs/remotes/origin/main' })))).toBeNull()
  })
})

describe('buildNotices', () => {
  it('커밋 하나', () => {
    const n = buildNotices('sample-app', [entry('commit: 로그인 수정')], ALL)
    expect(n).toEqual([{ title: 'sample-app · 커밋', body: 'main: 로그인 수정', warn: false }])
  })

  it('끈 종류는 알리지 않는다', () => {
    expect(buildNotices('app', [entry('commit: x')], { ...ALL, notifyCommit: false })).toEqual([])
    expect(buildNotices('app', [entry('checkout: moving from a to b', { refName: 'HEAD' })], { ...ALL, notifyBranch: false })).toEqual([])
  })

  it('위험한 작업은 경고로, 하나씩', () => {
    const n = buildNotices('app', [entry('update by push', { refName: 'refs/remotes/origin/main', dropped: 2 })], ALL)
    expect(n[0].warn).toBe(true)
    expect(n[0].title).toBe('⚠ app · 강제 push')
    expect(n[0].body).toContain('커밋 2개가 사라졌습니다')
  })

  it('많으면 묶고, 오래된 것부터', () => {
    const fresh = [
      entry('commit: 넷', { time: 104 }),
      entry('update by push', { time: 103, refName: 'refs/remotes/origin/main' }),
      entry('commit: 둘', { time: 102 }),
      entry('reset: moving to HEAD~1', { time: 101, dropped: 1 }),
      entry('commit: 하나', { time: 100 }),
    ]
    const n = buildNotices('app', fresh, ALL)
    expect(n).toHaveLength(2)
    expect(n[0].title).toBe('⚠ app · reset')
    expect(n[1].title).toBe('app · 새 활동 4개')
    expect(n[1].body).toContain('커밋 3 · push 1')
  })

  it('적으면 하나씩, 오래된 것부터', () => {
    const n = buildNotices('app', [entry('commit: 둘', { subject: '둘' }), entry('commit: 하나', { subject: '하나' })], ALL)
    expect(n.map((x) => x.body)).toEqual(['main: 하나', 'main: 둘'])
  })

  it('rebase 단계는 하나로', () => {
    const n = buildNotices(
      'app',
      [entry('rebase (finish): returning to refs/heads/main'), entry('rebase (pick): a'), entry('rebase (start): checkout origin/main')],
      ALL,
    )
    expect(n).toHaveLength(1)
    expect(n[0].title).toContain('rebase ×3')
  })
})
