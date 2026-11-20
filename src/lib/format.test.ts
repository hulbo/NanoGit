import { describe, expect, it } from 'vitest'
import { basename, dirname, joinPath, relative, shortDate } from './format'

describe('format', () => {
  const now = new Date(2026, 10, 20, 12, 0, 0).getTime()

  it('상대 시각', () => {
    expect(relative(now - 2000, now)).toBe('방금')
    expect(relative(now - 12000, now)).toBe('12초 전')
    expect(relative(now - 5 * 60000, now)).toBe('5분 전')
    expect(relative(now - 3 * 3600000, now)).toBe('3시간 전')
  })

  it('짧은 날짜', () => {
    expect(shortDate(new Date(2026, 10, 20, 9, 5).getTime() / 1000, now)).toBe('09:05')
    expect(shortDate(new Date(2026, 10, 19, 22, 1).getTime() / 1000, now)).toBe('어제 22:01')
    expect(shortDate(new Date(2026, 2, 1, 8, 0).getTime() / 1000, now)).toBe('3월 1일 08:00')
    expect(shortDate(new Date(2025, 2, 1).getTime() / 1000, now)).toBe('2025-03-01')
  })

  it('경로', () => {
    expect(basename('src/lib/a.ts')).toBe('a.ts')
    expect(dirname('src/lib/a.ts')).toBe('src/lib')
    expect(dirname('a.ts')).toBe('')
    expect(joinPath('C:/Project/app', 'src/a.ts')).toBe('C:\\Project\\app\\src\\a.ts')
  })
})
