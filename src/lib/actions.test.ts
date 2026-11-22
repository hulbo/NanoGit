import { describe, expect, it } from 'vitest'
import { ignorePatterns, localNameOf, pathsOf } from './actions'
import { initialValues, missingField, type DialogField } from './dialog'

describe('직접 조작 도우미', () => {
  it('원격 브랜치에서 로컬 이름을 만든다', () => {
    expect(localNameOf('origin/feature/login', ['origin', 'upstream'])).toBe('feature/login')
    expect(localNameOf('upstream/main', ['origin', 'upstream'])).toBe('main')
    expect(localNameOf('other/x', ['origin'])).toBe('other/x')
  })

  it('무시 규칙 후보: 파일, 확장자, 폴더', () => {
    expect(ignorePatterns('logs/app.log').map((p) => p.pattern)).toEqual(['/logs/app.log', '*.log', '/logs/'])
    expect(ignorePatterns('Makefile').map((p) => p.pattern)).toEqual(['/Makefile'])
    expect(ignorePatterns('.env').map((p) => p.pattern)).toEqual(['/.env'])
  })

  it('이름이 바뀐 파일은 이전 경로도 넘긴다', () => {
    expect(
      pathsOf([
        { path: 'src/login.ts', oldPath: 'src/auth.ts' },
        { path: 'README.md', oldPath: null },
        { path: 'README.md', oldPath: null },
      ]),
    ).toEqual(['src/login.ts', 'src/auth.ts', 'README.md'])
  })
})

describe('대화상자 값', () => {
  const fields: DialogField[] = [
    { kind: 'text', key: 'name', label: '브랜치 이름', required: true },
    { kind: 'select', key: 'mode', label: '방식', value: 'merge', options: [{ value: 'merge', label: '병합' }] },
    { kind: 'check', key: 'checkout', label: '전환', value: true },
    { kind: 'info', text: '안내' },
  ]

  it('처음 값을 채운다', () => {
    expect(initialValues(fields)).toEqual({ name: '', mode: 'merge', checkout: true })
  })

  it('빈 필수 칸을 찾는다', () => {
    expect(missingField(fields, { name: '  ' })).toBe('브랜치 이름')
    expect(missingField(fields, { name: 'feature/x' })).toBeNull()
  })
})
