// 트레이 툴팁·메뉴에 보일 저장소 요약

export interface TrayTab {
  root: string
  name: string
  branch: string | null
  changes: number
  ahead: number
  unseen: number
}

export interface TraySummary {
  tooltip: string
  repos: { root: string; label: string }[]
  notify: boolean
  alert: boolean
}

function parts(t: { changes: number; ahead: number; unseen: number }): string[] {
  const p: string[] = []
  if (t.changes) p.push(`변경 ${t.changes}`)
  if (t.ahead) p.push(`push 대기 ${t.ahead}`)
  if (t.unseen) p.push(`새 활동 ${t.unseen}`)
  return p
}

export function traySummary(tabs: TrayTab[], notify: boolean): TraySummary {
  const repos = tabs.map((t) => ({
    root: t.root,
    label: [`${t.name}${t.branch ? ` (${t.branch})` : ''}`, ...parts(t)].join(' · '),
  }))
  const total = tabs.reduce((a, t) => ({ changes: a.changes + t.changes, ahead: a.ahead + t.ahead, unseen: a.unseen + t.unseen }), { changes: 0, ahead: 0, unseen: 0 })
  const sum = parts(total)
  const tooltip = tabs.length ? `NanoGit · ${sum.length ? sum.join(' · ') : `저장소 ${tabs.length}개 감시 중`}` : 'NanoGit'
  return { tooltip, repos, notify, alert: total.unseen > 0 }
}
