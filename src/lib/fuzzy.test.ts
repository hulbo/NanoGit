import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore, isWildcard, searchFiles, wildcardPattern } from './fuzzy'

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

describe('와일드카드(like) 검색', () => {
  const files = [
    'front/isbm-c/src/js/pages/biz/modules/eduAtteNew/EduAtteNewDetail.vue',
    'apps/portal/src/main/java/kr/example/bm/edu/crclm/entity/PtEduCrclm.java',
    'apps/isbm/src/main/resources/mapper/biz/mdle/eduCrclmNew/BmEduCrclmNewMapper.xml',
    'apps/portal/src/main/java/kr/example/mypage/PtCrtfIssuAplyService.java',
    'apps/portal/src/main/resources/mapper/mypage/MyDataReqMapper_oracle.xml',
    'README.md',
  ]

  it('*edu*는 이름에 edu가 들어간 파일 (대소문자 무시, 이름이 짧은 것부터)', () => {
    const r = searchFiles('*edu*', files)
    expect(r.total).toBe(3)
    expect(r.list[0]).toMatch(/PtEduCrclm\.java$/)
    expect(r.list).not.toContain(files[3])
  })

  it('끝에는 *가 붙은 것으로 본다 (이클립스처럼 앞에서부터 맞춤)', () => {
    expect(searchFiles('Pt*Service', files).list).toEqual([files[3]])
    expect(searchFiles('*mapper_ora*', files).list).toEqual([files[4]])
    expect(searchFiles('edu*', files).list[0]).toBe(files[0])
    expect(searchFiles('*.md', files).list).toEqual(['README.md'])
  })

  it('?는 한 글자', () => {
    expect(searchFiles('Pt?du*', files).list).toEqual([files[1]])
    expect(searchFiles('Pt??du*', files).total).toBe(0)
  })

  it("'/'가 있으면 폴더 경계부터 경로에 맞춘다", () => {
    expect(searchFiles('mapper/*edu*', files).list).toEqual([files[2]])
    expect(searchFiles('*/mypage/*.xml', files).list).toEqual([files[4]])
    expect(searchFiles('apper/*', files).total).toBe(0)
  })

  it('이름에서 맞는 파일 다음에 경로 전체에서 맞는 파일', () => {
    const paths = ['apps/isbm/src/main/resources/application.yml', 'apps/link/src/main/resources/application.yml', 'apps/isbm/src/main/resources/isbm-application.yml']
    // 이름에 isbm과 appli가 다 있는 것이 먼저, 그다음 경로에서
    expect(searchFiles('*isbm*appli*.yml', paths).list).toEqual([paths[2], paths[0]])
    expect(searchFiles('isbm*appli*', paths).list).toEqual([paths[2], paths[0]])
    expect(searchFiles('*link*appli*', paths).list).toEqual([paths[1]])
    // 이름에서 맞으면 앞에
    expect(searchFiles('edu*', files).list).toEqual([files[0], files[1], files[2]])
  })

  it("'/'는 그 사이 폴더를 건너뛸 수 있다", () => {
    const paths = ['apps/isbm/src/main/resources/application.yml', 'apps/link/src/main/resources/application.yml']
    expect(searchFiles('*link/appli*yml', paths).list).toEqual([paths[1]])
    expect(searchFiles('link/appli*', paths).list).toEqual([paths[1]])
    expect(searchFiles('ink/appli*', paths).total).toBe(0)
  })

  it('정규식 특수 문자는 글자 그대로', () => {
    expect(isWildcard('a.b')).toBe(false)
    expect(searchFiles('*(x)*', ['a(x).ts', 'ax.ts']).list).toEqual(['a(x).ts'])
    expect(wildcardPattern('a.b*').re?.test('aXb.ts')).toBe(false)
  })
})
