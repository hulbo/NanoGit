import { describe, expect, it } from 'vitest'
import { parseDiff } from './diff'
import { highlightDiff, highlightLines, languageOf, withMark, type Tok } from './highlight'

const text = (toks: Tok[]) => toks.map((t) => t.t).join('')
const classOfWord = (toks: Tok[], word: string) => toks.find((t) => t.t.includes(word))?.c

describe('언어 고르기', () => {
  it('확장자와 파일 이름으로', () => {
    expect(languageOf('apps/src/main/resources/application-production.yml')).toBe('yaml')
    expect(languageOf('src/main/java/kr/example/OrderService.java')).toBe('java')
    expect(languageOf('front/src/pages/OrderList.vue')).toBe('xml')
    expect(languageOf('build.gradle')).toBe('gradle')
    expect(languageOf('docker/Dockerfile.dev')).toBe('dockerfile')
    expect(languageOf('.env.local')).toBe('properties')
    expect(languageOf('C:\\work\\run.BAT')).toBe('dos')
    expect(languageOf('notes.txt')).toBeNull()
    expect(languageOf('LICENSE')).toBeNull()
    expect(languageOf(null)).toBeNull()
  })

  it('MyBatis 매퍼 XML은 내용으로 알아본다', () => {
    expect(languageOf('mapper/OrderMapper.xml', '<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN">')).toBe('mybatis')
    expect(languageOf('mapper/OrderMapper.xml', '  AND ORD.ID = #{orderId}')).toBe('mybatis')
    expect(languageOf('pom.xml', '<project><modelVersion>4.0.0</modelVersion>')).toBe('xml')
  })
})

describe('줄 강조', () => {
  it('줄 수와 글자를 그대로 두고 색만 나눈다', () => {
    const lines = ['spring:', '  datasource:', '    maximum-pool-size: 400 # 주석', '    secure: true']
    const out = highlightLines(lines, 'yaml')!
    expect(out).toHaveLength(4)
    expect(out.map(text)).toEqual(lines)
    expect(classOfWord(out[0], 'spring')).toBe('hl-k')
    expect(classOfWord(out[2], '400')).toBe('hl-n')
    expect(classOfWord(out[2], '# 주석')).toBe('hl-c')
  })

  it('여러 줄 주석은 줄마다 주석 색', () => {
    const lines = ['/**', ' * 주문을 찾는다 @param id', ' */', '@Service', 'public class OrderService {', '  String name() { return "x"; }', '}']
    const out = highlightLines(lines, 'java')!
    expect(out.map(text)).toEqual(lines)
    expect(out[1][0].c).toBe('hl-c')
    expect(classOfWord(out[1], '@param')).toBe('hl-d')
    expect(out[2][0].c).toBe('hl-c')
    expect(classOfWord(out[3], '@Service')).toBe('hl-m')
    expect(classOfWord(out[4], 'public')).toBe('hl-k')
    expect(classOfWord(out[5], 'name')).toBe('hl-f')
    expect(classOfWord(out[5], '"x"')).toBe('hl-s')
  })

  it('HTML 특수 문자는 글자로 돌려 놓는다', () => {
    const out = highlightLines(['<a href="x?a=1&b=2">\'q\' < 3</a>'], 'xml')!
    expect(text(out[0])).toBe('<a href="x?a=1&b=2">\'q\' < 3</a>')
  })

  it('매퍼 XML의 태그 사이 SQL도 강조한다', () => {
    const lines = ['<mapper namespace="sample.OrderMapper">', '  <select id="find" resultType="map">', '    SELECT ORD.ID FROM ORDERS ORD', '     WHERE ORD.ID = #{orderId}', '    <![CDATA[ AND ORD.AMT < 100 ]]>', '  </select>', '</mapper>']
    const out = highlightLines(lines, 'mybatis')!
    expect(out.map(text)).toEqual(lines)
    expect(classOfWord(out[1], 'select')).toBe('hl-t')
    expect(classOfWord(out[1], 'resultType')).toBe('hl-a')
    expect(classOfWord(out[2], 'SELECT')).toBe('hl-k')
    expect(classOfWord(out[3], '#{orderId}')).toBe('hl-p')
    expect(classOfWord(out[4], '<![CDATA[')).toBe('hl-m')
    expect(classOfWord(out[4], '100')).toBe('hl-n')
  })

  it('언어를 모르면 강조하지 않는다', () => {
    expect(highlightLines(['a'], null)).toBeNull()
    expect(highlightLines([], 'java')).toBeNull()
  })
})

describe('diff 강조', () => {
  it('옛 줄과 새 줄을 각자 강조한다', () => {
    const files = parseDiff(
      ['diff --git a/app.yml b/app.yml', '--- a/app.yml', '+++ b/app.yml', '@@ -1,3 +1,3 @@', ' server:', '-  port: 8080', '+  port: 9090', '   debug: true'].join('\n'),
    )
    highlightDiff(files)
    const [ctx, del, add, ctx2] = files[0].hunks[0].lines
    expect(classOfWord(ctx.toks!, 'server')).toBe('hl-k')
    expect(classOfWord(del.toks!, '8080')).toBe('hl-n')
    expect(classOfWord(add.toks!, '9090')).toBe('hl-n')
    expect(classOfWord(ctx2.toks!, 'true')).toBe('hl-k')
  })

  it('언어를 모르는 파일은 그대로', () => {
    const files = parseDiff(['--- a/readme.txt', '+++ b/readme.txt', '@@ -1 +1 @@', '-a', '+b'].join('\n'))
    highlightDiff(files)
    expect(files[0].hunks[0].lines[0].toks).toBeUndefined()
  })
})

describe('바뀐 부분 표시', () => {
  it('조각 경계와 상관없이 [시작, 끝)만 표시한다', () => {
    const toks: Tok[] = [
      { t: 'port', c: 'hl-k' },
      { t: ': ', c: '' },
      { t: '8080', c: 'hl-n' },
    ]
    const out = withMark(toks, [2, 8])
    expect(out.map((p) => p.t).join('')).toBe('port: 8080')
    expect(out.filter((p) => p.m).map((p) => p.t)).toEqual(['rt', ': ', '80'])
    expect(out.find((p) => p.t === 'rt')!.c).toBe('hl-k')
    expect(withMark(toks, undefined)).toBe(toks)
  })
})
