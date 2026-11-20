// 새 활동 → Windows 알림. 무엇을 알릴지 고르고, 한꺼번에 많이 생기면 묶는다

import { groupActivity, type ActivityItem, type ActivityView } from './activity'
import type { ActivityEntry, Settings } from './types'

export type NotifyGroup = 'commit' | 'push' | 'branch' | 'warn'

/** 활동 종류 → 알림 묶음 (알리지 않는 종류는 null) */
export function notifyGroup(v: ActivityView): NotifyGroup | null {
  // reset·강제 push·amend·rebase·분리된 HEAD·원격 이력 재작성
  if (v.severity !== 'normal') return 'warn'
  switch (v.kind) {
    case 'commit':
    case 'initial':
    case 'merge-commit':
    case 'cherry-pick':
    case 'revert':
      return 'commit'
    case 'push':
      return 'push'
    case 'checkout':
    case 'merge':
    case 'pull':
    case 'branch':
    case 'rename':
    case 'stash':
      return 'branch'
    default:
      // fetch(정상), clone, 기타는 알리지 않는다
      return null
  }
}

export type NotifyPrefs = Pick<Settings, 'notifyCommit' | 'notifyPush' | 'notifyBranch' | 'notifyWarn'>

function wanted(g: NotifyGroup | null, p: NotifyPrefs): boolean {
  switch (g) {
    case 'commit':
      return p.notifyCommit
    case 'push':
      return p.notifyPush
    case 'branch':
      return p.notifyBranch
    case 'warn':
      return p.notifyWarn
    default:
      return false
  }
}

export interface Notice {
  title: string
  body: string
  warn: boolean
}

function one(repo: string, i: ActivityItem): Notice {
  const v = i.view
  const warn = v.severity !== 'normal'
  const steps = i.steps > 1 ? ` ×${i.steps}` : ''
  const where = v.ref && !v.title.includes(v.ref) ? `${v.ref}: ` : ''
  return {
    title: `${warn ? '⚠ ' : ''}${repo} · ${v.label}${steps}`,
    body: `${where}${v.title}${v.note ? `\n${v.note}` : ''}`,
    warn,
  }
}

const GROUP_NAME: Record<NotifyGroup, string> = { commit: '커밋', push: 'push', branch: '브랜치', warn: '주의' }

/**
 * 새 활동(최근 것이 위)으로 보낼 알림을 만든다.
 * 주의가 필요한 작업은 하나씩 알리고, 나머지가 많으면 한 알림으로 묶는다. 최대 `max`개.
 */
export function buildNotices(repo: string, fresh: ActivityEntry[], prefs: NotifyPrefs, max = 3): Notice[] {
  // 오래된 것부터 알린다
  const items = groupActivity(fresh)
    .filter((i) => wanted(notifyGroup(i.view), prefs))
    .reverse()
  if (!items.length) return []
  const warns = items.filter((i) => i.view.severity !== 'normal')
  const rest = items.filter((i) => i.view.severity === 'normal')
  const out: Notice[] = warns.slice(0, max).map((i) => one(repo, i))
  const room = max - out.length
  if (room <= 0 || !rest.length) return out
  if (rest.length <= room) return [...out, ...rest.map((i) => one(repo, i))]
  // 묶음: "커밋 3 · push 1", 본문은 가장 최근 것
  const counts = new Map<NotifyGroup, number>()
  for (const i of rest) {
    const g = notifyGroup(i.view)!
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  const summary = [...counts].map(([g, n]) => `${GROUP_NAME[g]} ${n}`).join(' · ')
  const latest = rest[rest.length - 1].view
  out.push({ title: `${repo} · 새 활동 ${rest.length}개`, body: `${summary}\n최근: ${latest.label} ${latest.title}`, warn: false })
  return out
}
