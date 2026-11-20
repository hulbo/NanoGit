import { describe, expect, it } from 'vitest'
import { changedRange, diffStats, parseDiff, splitRows, unifiedRows } from './diff'

const SAMPLE = [
  'diff --git a/auth.ts b/login.ts',
  'similarity index 81%',
  'rename from auth.ts',
  'rename to login.ts',
  'index 0ce6c09..9740c89 100644',
  '--- a/auth.ts',
  '+++ b/login.ts',
  '@@ -1,3 +1,4 @@ function x()',
  ' a',
  '-b',
  '+b2',
  ' c\r',
  '+d',
  '\\ No newline at end of file',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  '',
].join('\n')

describe('parseDiff', () => {
  it('파일·헝크·줄 번호', () => {
    const files = parseDiff(SAMPLE)
    expect(files).toHaveLength(2)
    expect(files[0].oldPath).toBe('auth.ts')
    expect(files[0].newPath).toBe('login.ts')
    const lines = files[0].hunks[0].lines
    expect(lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'add', 'ctx', 'add', 'nonl'])
    expect(lines[1]).toMatchObject({ text: 'b', old: 2, new: null })
    expect(lines[2]).toMatchObject({ text: 'b2', old: null, new: 2 })
    // CRLF의 \r은 떼고 보여 준다
    expect(lines[3]).toMatchObject({ text: 'c', old: 3, new: 3 })
    expect(lines[4].new).toBe(4)
    expect(files[1].binary).toBe(true)
    expect(diffStats(files)).toEqual({ additions: 2, deletions: 1 })
  })

  it('추적 안 하는 새 파일 (/dev/null)', () => {
    const files = parseDiff('diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\t\n@@ -0,0 +1 @@\n+new\n')
    expect(files[0].oldPath).toBeNull()
    expect(files[0].newPath).toBe('n.txt')
    expect(files[0].hunks[0].lines[0]).toMatchObject({ kind: 'add', new: 1 })
  })
})

describe('보기 변환', () => {
  it('바뀐 부분 강조', () => {
    expect(changedRange('const a = 1', 'const a = 2')).toEqual({ a: [10, 11], b: [10, 11] })
    expect(changedRange('same', 'same')).toBeNull()
    expect(changedRange('abc', 'xyz')).toBeNull()
  })

  it('통합 보기 행', () => {
    const rows = unifiedRows(parseDiff(SAMPLE), true)
    expect(rows[0]).toMatchObject({ kind: 'file', text: 'login.ts' })
    expect(rows[1].kind).toBe('hunk')
    const del = rows.find((r) => r.kind === 'del')!
    const add = rows.find((r) => r.kind === 'add')!
    expect(del.mark).toEqual([1, 1])
    expect(add.mark).toEqual([1, 2])
  })

  it('나란히 보기는 삭제·추가를 같은 줄에 맞춘다', () => {
    const rows = splitRows(parseDiff(SAMPLE))
    expect(rows[0].hunk).toBeDefined()
    expect(rows[1].left?.text).toBe('a')
    expect(rows[2].left).toMatchObject({ kind: 'del', text: 'b', no: 2 })
    expect(rows[2].right).toMatchObject({ kind: 'add', text: 'b2', no: 2 })
    expect(rows[4].left).toBeNull()
    expect(rows[4].right).toMatchObject({ kind: 'add', text: 'd' })
  })
})
