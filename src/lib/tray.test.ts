import { describe, expect, it } from 'vitest'
import { traySummary } from './tray'

describe('traySummary', () => {
  it('저장소마다 한 줄, 툴팁은 합계', () => {
    const s = traySummary(
      [
        { root: 'C:/p/app', name: 'app', branch: 'main', changes: 3, ahead: 2, unseen: 0 },
        { root: 'C:/p/api', name: 'api', branch: null, changes: 0, ahead: 0, unseen: 1 },
      ],
      true,
    )
    expect(s.repos).toEqual([
      { root: 'C:/p/app', label: 'app (main) · 변경 3 · push 대기 2' },
      { root: 'C:/p/api', label: 'api · 새 활동 1' },
    ])
    expect(s.tooltip).toBe('NanoGit · 변경 3 · push 대기 2 · 새 활동 1')
    expect(s.alert).toBe(true)
    expect(s.notify).toBe(true)
  })

  it('조용할 때', () => {
    const s = traySummary([{ root: 'C:/p/app', name: 'app', branch: 'main', changes: 0, ahead: 0, unseen: 0 }], false)
    expect(s.tooltip).toBe('NanoGit · 저장소 1개 감시 중')
    expect(s.alert).toBe(false)
    expect(traySummary([], true).tooltip).toBe('NanoGit')
  })
})
