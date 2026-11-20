import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

describe('fuzzy', () => {
  const files = ['src/lib/login.ts', 'src/lib/components/LoginForm.svelte', 'docs/login-guide.md', 'src/app.ts', 'README.md']

  it('파일 이름에서 맞는 것이 먼저', () => {
    expect(fuzzyFilter('login', files)[0]).toBe('src/lib/login.ts')
    expect(fuzzyFilter('login', files)).toHaveLength(3)
  })

  it('글자가 순서대로 있으면 맞음', () => {
    expect(fuzzyScore('lgf', 'src/lib/components/LoginForm.svelte')).not.toBeNull()
    expect(fuzzyScore('zz', 'src/app.ts')).toBeNull()
    expect(fuzzyFilter('srcapp', files)[0]).toBe('src/app.ts')
  })

  it('빈 검색어는 앞에서부터', () => {
    expect(fuzzyFilter('', files, 2)).toEqual(files.slice(0, 2))
  })
})
