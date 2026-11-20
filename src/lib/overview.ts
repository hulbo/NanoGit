// 저장소 요약 화면: 여러 저장소를 한눈에 (마지막 변화, 최근 바뀐 파일, 경고, 전체 활동)

import { describe, type ActivityView } from './activity'
import type { ActivityEntry, Status, WorkFile } from './types'

export interface RepoSnapshot {
  root: string
  name: string
  status: Status | null
  activity: ActivityEntry[] | null
  /** 감시가 마지막으로 변화를 알린 시각(ms) */
  pulse: number
}

/** 마지막 변화 시각(ms): 감시 알림, 최근 활동, 작업 트리 파일 수정 시각 중 가장 늦은 것 */
export function lastChange(r: RepoSnapshot): number {
  let t = r.pulse
  const a = r.activity?.[0]
  if (a) t = Math.max(t, a.time * 1000)
  for (const f of allFiles(r.status)) if (f.mtime) t = Math.max(t, f.mtime)
  return t
}

function allFiles(s: Status | null): WorkFile[] {
  return s ? [...s.conflicted, ...s.staged, ...s.unstaged] : []
}

/** 최근에 바뀐 작업 트리 파일 (같은 파일은 한 번) */
export function recentFiles(s: Status | null, n = 3): WorkFile[] {
  const seen = new Set<string>()
  const out: WorkFile[] = []
  for (const f of allFiles(s).sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))) {
    if (seen.has(f.path)) continue
    seen.add(f.path)
    out.push(f)
    if (out.length === n) break
  }
  return out
}

/** `sinceSec` 이후 주의가 필요한 작업 수 */
export function warningCount(activity: ActivityEntry[] | null, sinceSec: number): number {
  return (activity ?? []).filter((e) => e.time >= sinceSec && describe(e).severity !== 'normal').length
}

export interface FeedItem {
  root: string
  name: string
  entry: ActivityEntry
  view: ActivityView
}

/** 모든 저장소의 활동을 시간순으로 합친다 (최근 것이 위) */
export function mergeFeed(repos: RepoSnapshot[], limit = 60): FeedItem[] {
  const all: FeedItem[] = []
  for (const r of repos) for (const e of (r.activity ?? []).slice(0, limit)) all.push({ root: r.root, name: r.name, entry: e, view: describe(e) })
  return all.sort((a, b) => b.entry.time - a.entry.time).slice(0, limit)
}

export type RepoSort = 'recent' | 'tabs' | 'name'

export function sortRepos<T extends RepoSnapshot>(repos: T[], mode: RepoSort): T[] {
  if (mode === 'tabs') return [...repos]
  if (mode === 'name') return [...repos].sort((a, b) => a.name.localeCompare(b.name))
  return [...repos].sort((a, b) => lastChange(b) - lastChange(a))
}
