import { describe, expect, it } from 'vitest'
import { grepRegex, maskMatches, splitMatches } from './grep'
import type { GrepQuery } from './types'

const q = (text: string, o: Partial<GrepQuery> = {}): GrepQuery => ({ text, caseSensitive: false, wholeWord: false, regex: false, mask: '', ...o })
const hits = (text: string, query: GrepQuery) =>
  splitMatches(text, grepRegex(query))
    .filter((p) => p.hit)
    .map((p) => p.t)

describe('내용으로 찾기: 맞은 곳 칠하기', () => {
  it('글자 그대로, 대소문자 무시가 기본', () => {
    expect(hits('Find find FIND', q('find'))).toEqual(['Find', 'find', 'FIND'])
    expect(hits('a.b axb', q('a.b'))).toEqual(['a.b'])
    expect(hits('Find find', q('find', { caseSensitive: true }))).toEqual(['find'])
  })

  it('단어 단위', () => {
    expect(hits('finder find(1) _find find', q('find', { wholeWord: true }))).toEqual(['find', 'find'])
  })

  it('정규식, 틀린 정규식은 칠하지 않는다', () => {
    expect(hits('find(1) find(22)', q('find\\(\\d+\\)', { regex: true }))).toEqual(['find(1)', 'find(22)'])
    expect(grepRegex(q('(', { regex: true }))).toBeNull()
    expect(splitMatches('abc', null)).toEqual([{ t: 'abc', hit: false }])
  })

  it('조각을 이으면 원래 줄', () => {
    const text = '한글 찾기와 찾기'
    expect(
      splitMatches(text, grepRegex(q('찾기')))
        .map((p) => p.t)
        .join(''),
    ).toBe(text)
  })
})

describe('파일 마스크', () => {
  it('이름 패턴은 모든 폴더에서, !는 빼기', () => {
    expect(maskMatches('', 'src/a.ts')).toBe(true)
    expect(maskMatches('*.*', 'README')).toBe(true)
    expect(maskMatches('*.java, *.xml', 'src/web/Login.java')).toBe(true)
    expect(maskMatches('*.java, *.xml', 'src/app.ts')).toBe(false)
    expect(maskMatches('!*.min.js', 'dist/app.min.js')).toBe(false)
    expect(maskMatches('!*.min.js', 'src/app.js')).toBe(true)
    expect(maskMatches('*.JAVA', 'Login.java')).toBe(true)
  })

  it("'/'가 있으면 경로로", () => {
    expect(maskMatches('src/web/*', 'src/web/Login.java')).toBe(true)
    expect(maskMatches('src/web/*', 'src/app.ts')).toBe(false)
    expect(maskMatches('src/**', 'src/web/Login.java')).toBe(true)
  })
})
