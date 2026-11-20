// reflog 항목 → 활동 타임라인 표시 (종류, 설명, 위험도)

import type { ActivityEntry } from './types'
import { short } from './format'

export type ActivityKind =
  | 'commit'
  | 'initial'
  | 'amend'
  | 'merge-commit'
  | 'checkout'
  | 'reset'
  | 'merge'
  | 'pull'
  | 'rebase'
  | 'cherry-pick'
  | 'revert'
  | 'push'
  | 'fetch'
  | 'branch'
  | 'rename'
  | 'stash'
  | 'clone'
  | 'other'

export type Severity = 'normal' | 'caution' | 'danger'

export interface ActivityView {
  kind: ActivityKind
  /** 짧은 이름 (커밋, push …) */
  label: string
  /** 한 줄 설명 */
  title: string
  /** 덧붙일 설명·경고 */
  note: string | null
  severity: Severity
  /** 관련 브랜치 (로컬 `main`, 원격 `origin/main`) */
  ref: string | null
  /** 커밋 관련 작업이라 diff를 볼 수 있음 */
  showsCommit: boolean
}

export type ActivityFilter = 'all' | 'commit' | 'branch' | 'remote' | 'warn'

const HEX40 = /^[0-9a-f]{40,64}$/

function refShort(refName: string): string | null {
  if (refName.startsWith('refs/heads/')) return refName.slice(11)
  if (refName.startsWith('refs/remotes/')) return refName.slice(13)
  return null
}

const after = (msg: string, prefix: string) => msg.slice(prefix.length).trim()

export function describe(e: ActivityEntry): ActivityView {
  const msg = e.message
  const ref = refShort(e.refName)
  const subject = e.subject ?? short(e.new)
  const v = (kind: ActivityKind, label: string, title: string, severity: Severity = 'normal', note: string | null = null, showsCommit = true): ActivityView => ({
    kind,
    label,
    title,
    note,
    severity,
    ref,
    showsCommit,
  })

  if (e.refName === 'refs/stash') {
    return v('stash', 'stash', msg.replace(/^(WIP on|On) /, ''), 'normal', null, true)
  }

  if (e.refName.startsWith('refs/remotes/')) {
    const created = /^0+$/.test(e.old)
    if (msg.startsWith('update by push')) {
      if (e.dropped > 0)
        return v('push', '강제 push', `${ref} ← ${subject}`, 'danger', `원격에서 커밋 ${e.dropped}개가 사라졌습니다 (이전: ${e.oldSubject ?? short(e.old)})`)
      return v('push', 'push', `${ref} ← ${subject}`, 'normal', created ? '원격에 새 브랜치' : null)
    }
    if (msg.startsWith('fetch') || msg.startsWith('pull')) {
      const forced = msg.includes('forced-update') || e.dropped > 0
      if (forced) return v('fetch', 'fetch', `${ref} → ${subject}`, 'caution', `원격 이력이 다시 쓰였습니다${e.dropped ? ` (커밋 ${e.dropped}개 사라짐)` : ''}`)
      return v('fetch', 'fetch', `${ref} → ${subject}`, 'normal', created ? '새 원격 브랜치' : null)
    }
    return v('other', '원격', `${ref}: ${msg}`)
  }

  if (msg.startsWith('commit (initial):')) return v('initial', '첫 커밋', after(msg, 'commit (initial):'))
  if (msg.startsWith('commit (amend):'))
    return v('amend', 'amend', after(msg, 'commit (amend):'), 'caution', `이전 커밋 ${short(e.old)}${e.oldSubject ? ` "${e.oldSubject}"` : ''}을(를) 고쳐 다시 만듦`)
  if (msg.startsWith('commit (merge):')) return v('merge-commit', '병합 커밋', after(msg, 'commit (merge):'))
  if (msg.startsWith('commit:')) return v('commit', '커밋', after(msg, 'commit:'))

  if (msg.startsWith('checkout: moving from ')) {
    const m = /^checkout: moving from (.+) to (.+)$/.exec(msg)
    const from = m?.[1] ?? ''
    const to = m?.[2] ?? ''
    if (HEX40.test(to) || (to.length >= 7 && /^[0-9a-f]+$/.test(to) && !e.refName.startsWith('refs/heads/')))
      return v('checkout', '전환', `${from} → ${short(to)}`, 'caution', '분리된 HEAD: 브랜치가 아닌 커밋으로 전환', false)
    return v('checkout', '전환', `${from} → ${to}`, 'normal', null, false)
  }
  if (msg.startsWith('reset: moving to ')) {
    const target = after(msg, 'reset: moving to ')
    if (e.dropped > 0)
      return v('reset', 'reset', `${ref ?? 'HEAD'}을(를) ${target}(으)로 되돌림`, 'danger', `커밋 ${e.dropped}개가 브랜치에서 빠졌습니다 (이전 끝: ${e.oldSubject ?? short(e.old)})`)
    return v('reset', 'reset', `${ref ?? 'HEAD'}을(를) ${target}(으)로 옮김`, 'caution')
  }
  if (msg.startsWith('merge ')) {
    const m = /^merge (.+?): (.*)$/.exec(msg)
    const ff = /fast-forward/i.test(msg)
    return v('merge', '병합', `${m?.[1] ?? ''} → ${ref ?? 'HEAD'}${ff ? ' (fast-forward)' : ''}`)
  }
  if (msg.startsWith('pull')) {
    const rebase = msg.includes('--rebase') || msg.includes('rebase')
    return v('pull', 'pull', `${ref ?? 'HEAD'} ← ${subject}`, rebase ? 'caution' : 'normal', rebase ? 'pull --rebase: 로컬 커밋을 다시 만듦' : null)
  }
  if (msg.startsWith('rebase')) {
    const m = /^rebase(?: -i)? \((\w+)\)(?:: (.*))?$/.exec(msg)
    const step = m?.[1] ?? ''
    const rest = m?.[2] ?? ''
    const stepName: Record<string, string> = { start: '시작', finish: '끝', pick: 'pick', squash: 'squash', fixup: 'fixup', reword: 'reword', abort: '중단', continue: '계속' }
    return v('rebase', 'rebase', `${stepName[step] ?? step}${rest ? `: ${rest}` : ''}`, 'caution', step === 'finish' ? '커밋을 다시 만들어 이력이 바뀜' : null)
  }
  if (msg.startsWith('cherry-pick:')) return v('cherry-pick', 'cherry-pick', after(msg, 'cherry-pick:'))
  if (msg.startsWith('revert:')) return v('revert', 'revert', after(msg, 'revert:'))
  if (msg.startsWith('branch: Created from ')) return v('branch', '브랜치 생성', `${ref} (${after(msg, 'branch: Created from ')}에서)`, 'normal', null, false)
  if (msg.startsWith('branch: Reset to ')) return v('reset', '브랜치 이동', `${ref} → ${after(msg, 'branch: Reset to ')}`, 'caution', e.dropped ? `커밋 ${e.dropped}개가 브랜치에서 빠짐` : null)
  if (msg.startsWith('Branch: renamed ')) {
    const m = /^Branch: renamed refs\/heads\/(.+) to refs\/heads\/(.+)$/.exec(msg)
    return v('rename', '이름 변경', m ? `${m[1]} → ${m[2]}` : msg, 'normal', null, false)
  }
  if (msg.startsWith('clone: ')) return v('clone', 'clone', after(msg, 'clone: '), 'normal', null, false)
  return v('other', '기타', msg || '(메시지 없음)', 'normal', null, !/^0+$/.test(e.new))
}

export function matchesFilter(view: ActivityView, f: ActivityFilter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'commit':
      return ['commit', 'initial', 'amend', 'merge-commit', 'cherry-pick', 'revert'].includes(view.kind)
    case 'branch':
      return ['checkout', 'reset', 'merge', 'rebase', 'branch', 'rename', 'pull', 'stash'].includes(view.kind)
    case 'remote':
      return view.kind === 'push' || view.kind === 'fetch'
    case 'warn':
      return view.severity !== 'normal'
  }
}

export interface ActivityItem {
  entry: ActivityEntry
  view: ActivityView
  /** 묶인 rebase 단계 수 */
  steps: number
}

/** 이어진 rebase 단계는 하나로 묶는다 (최근 것이 위) */
export function groupActivity(entries: ActivityEntry[]): ActivityItem[] {
  const out: ActivityItem[] = []
  for (const entry of entries) {
    const view = describe(entry)
    const prev = out[out.length - 1]
    if (prev && view.kind === 'rebase' && prev.view.kind === 'rebase' && prev.entry.refName === entry.refName) {
      prev.steps++
      continue
    }
    out.push({ entry, view, steps: 1 })
  }
  return out
}

/** 새로 생긴 항목만 (이전에 본 가장 최근 항목 기준) */
export function newSince(entries: ActivityEntry[], seen: ActivityEntry | null): ActivityEntry[] {
  if (!seen) return []
  const out: ActivityEntry[] = []
  for (const e of entries) {
    if (e.time < seen.time) break
    if (e.time === seen.time && e.refName === seen.refName && e.new === seen.new && e.old === seen.old) break
    out.push(e)
  }
  return out
}
