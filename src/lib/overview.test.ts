import { describe, expect, it } from 'vitest'
import { lastChange, mergeFeed, recentFiles, sortRepos, warningCount, type RepoSnapshot } from './overview'
import type { ActivityEntry, Status } from './types'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

const entry = (time: number, message: string, p: Partial<ActivityEntry> = {}): ActivityEntry => ({
  time,
  refName: 'refs/heads/main',
  old: A,
  new: B,
  message,
  who: 'Claude',
  subject: null,
  oldSubject: null,
  dropped: 0,
  ...p,
})

const status = (files: [string, number | null][]): Status => ({
  root: '',
  branch: 'main',
  head: B,
  upstream: null,
  ahead: null,
  behind: null,
  state: null,
  staged: [{ path: files[0][0], oldPath: null, status: 'M', mtime: files[0][1] }],
  unstaged: files.map(([path, mtime]) => ({ path, oldPath: null, status: 'M', mtime })),
  conflicted: [],
  truncated: false,
})

const repo = (name: string, p: Partial<RepoSnapshot> = {}): RepoSnapshot => ({ root: `C:/p/${name}`, name, status: null, activity: null, pulse: 0, ...p })

describe('overview', () => {
  it('마지막 변화는 감시·활동·파일 중 가장 늦은 것', () => {
    expect(lastChange(repo('a', { pulse: 5000, activity: [entry(3, 'commit: x')] }))).toBe(5000)
    expect(lastChange(repo('a', { pulse: 1000, activity: [entry(9, 'commit: x')] }))).toBe(9000)
    expect(lastChange(repo('a', { status: status([['x.ts', 20000]]) }))).toBe(20000)
    expect(lastChange(repo('a'))).toBe(0)
  })

  it('최근 바뀐 파일은 같은 파일 한 번, 최근 것부터', () => {
    const s = status([
      ['a.ts', 100],
      ['b.ts', 300],
      ['c.ts', null],
      ['d.ts', 200],
    ])
    expect(recentFiles(s, 3).map((f) => f.path)).toEqual(['b.ts', 'd.ts', 'a.ts'])
  })

  it('경고 수 (기간 안의 주의 작업만)', () => {
    const act = [entry(100, 'reset: moving to HEAD~1', { dropped: 1 }), entry(90, 'commit: x'), entry(10, 'commit (amend): y')]
    expect(warningCount(act, 50)).toBe(1)
    expect(warningCount(act, 0)).toBe(2)
    expect(warningCount(null, 0)).toBe(0)
  })

  it('전체 활동은 저장소를 섞어 최근 순', () => {
    const feed = mergeFeed([repo('a', { activity: [entry(30, 'commit: a2'), entry(10, 'commit: a1')] }), repo('b', { activity: [entry(20, 'commit: b1')] })])
    expect(feed.map((f) => `${f.name}:${f.view.title}`)).toEqual(['a:a2', 'b:b1', 'a:a1'])
  })

  it('정렬', () => {
    const list = [repo('b', { pulse: 1 }), repo('a', { pulse: 3 }), repo('c', { pulse: 2 })]
    expect(sortRepos(list, 'recent').map((r) => r.name)).toEqual(['a', 'c', 'b'])
    expect(sortRepos(list, 'name').map((r) => r.name)).toEqual(['a', 'b', 'c'])
    expect(sortRepos(list, 'tabs').map((r) => r.name)).toEqual(['b', 'a', 'c'])
  })
})
