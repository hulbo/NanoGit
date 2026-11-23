// 브라우저 미리보기용 가짜 백엔드 (npm run dev로 띄운 화면을 일반 브라우저에서 열 때).
// 이름·메시지는 모두 지어낸 것이다.

import type { Backend } from './api'
import type {
  ActivityEntry,
  Blame,
  Commit,
  CommitDetail,
  FileChange,
  GitOp,
  HistoryEntry,
  OutgoingBranch,
  Refs,
  RepoChange,
  Settings,
  Status,
  TextBlob,
} from './types'

const SUBJECTS = [
  '로그인 화면 레이아웃 정리',
  'API 클라이언트 오류 처리 보강',
  '설정 저장 시 빈 값 무시',
  'README 설치 방법 갱신',
  '목록 정렬 기준 추가',
  '날짜 표시 형식 통일',
  '테스트: 세션 만료 경우 추가',
  '빌드 스크립트 정리',
  '검색 입력 지연 처리',
  '아이콘 정리',
  '권한 확인 로직 분리',
  '로그 메시지 다듬기',
  '페이지네이션 버그 수정',
  '의존성 버전 올림',
  '다크 테마 색 조정',
]
const AUTHORS = [
  ['김하늘', 'sky@example.com'],
  ['Claude', 'noreply@anthropic.com'],
  ['이도윤', 'doyun@example.com'],
]
const FILES = [
  'src/App.svelte',
  'src/main.ts',
  'src/lib/api.ts',
  'src/lib/auth/login.ts',
  'src/lib/auth/session.ts',
  'src/lib/components/LoginForm.svelte',
  'src/lib/components/List.svelte',
  'src/lib/format.ts',
  'src/lib/settings.ts',
  'src/styles/theme.css',
  'docs/guide.md',
  'README.md',
  'package.json',
  'vite.config.ts',
  'tests/session.test.ts',
  'server/src/main/resources/application.yml',
  'server/src/main/resources/mapper/OrderMapper.xml',
  'server/src/main/java/com/example/sample/order/OrderService.java',
]

const now = Math.floor(Date.now() / 1000)
const hex = (n: number, salt = 0) => {
  let h = (n * 2654435761 + salt * 40503) >>> 0
  let s = ''
  for (let i = 0; i < 5; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    s += h.toString(16).padStart(8, '0')
  }
  return s.slice(0, 40)
}

interface Node {
  sha: string
  parents: string[]
  author: number
  time: number
  subject: string
  i: number
}

// 이력 만들기: main 100개, feature/api(40에서 갈라져 50에서 병합), feature/login(97에서 갈라진 로컬 브랜치)
const nodes: Node[] = []
const main: string[] = []
for (let i = 0; i < 100; i++) {
  const sha = hex(i)
  main.push(sha)
  nodes.push({ sha, parents: i ? [main[i - 1]] : [], author: i % 3, time: now - (100 - i) * 5400, subject: SUBJECTS[i % SUBJECTS.length], i })
}
const feat: string[] = []
for (let k = 0; k < 5; k++) {
  const sha = hex(200 + k)
  feat.push(sha)
  nodes.push({ sha, parents: [k ? feat[k - 1] : main[40]], author: 1, time: now - (100 - 41 - k * 1.7) * 5400, subject: `API: ${SUBJECTS[(k + 4) % SUBJECTS.length]}`, i: 200 + k })
}
// 50번째 main 커밋을 병합 커밋으로
nodes[50].parents = [main[49], feat[4]]
nodes[50].subject = "Merge branch 'feature/api'"
const login: string[] = []
for (let k = 0; k < 3; k++) {
  const sha = hex(300 + k)
  login.push(sha)
  nodes.push({ sha, parents: [k ? login[k - 1] : main[97]], author: 1, time: now - 2400 + k * 500, subject: `로그인: ${['폼 검증 추가', '오류 문구 정리', '자동 로그인 옵션'][k]}`, i: 300 + k })
}
nodes.sort((a, b) => b.time - a.time)
const byShaMap = new Map(nodes.map((n) => [n.sha, n]))

const refsOf = (sha: string): Commit['refs'] => {
  const r: Commit['refs'] = []
  if (sha === main[99]) r.push({ kind: 'head', name: 'main' }, { kind: 'local', name: 'main' })
  if (sha === main[97]) r.push({ kind: 'remote', name: 'origin/main' })
  if (sha === login[2]) r.push({ kind: 'local', name: 'feature/login' })
  if (sha === feat[4]) r.push({ kind: 'local', name: 'feature/api' }, { kind: 'remote', name: 'origin/feature/api' })
  if (sha === main[30]) r.push({ kind: 'tag', name: 'v0.1.0' })
  if (sha === main[70]) r.push({ kind: 'tag', name: 'v0.2.0' })
  return r
}

const toCommit = (n: Node): Commit => ({
  sha: n.sha,
  parents: n.parents,
  author: AUTHORS[n.author][0],
  email: AUTHORS[n.author][1],
  time: n.time,
  subject: n.subject,
  refs: refsOf(n.sha),
})

function filesOf(n: Node): FileChange[] {
  if (n.parents.length === 0) return FILES.map((p) => ({ status: 'A', path: p, oldPath: null, additions: 20 + p.length, deletions: 0, binary: false }))
  const count = 1 + (n.i % 4)
  const out: FileChange[] = []
  for (let k = 0; k < count; k++) {
    const p = FILES[(n.i * 7 + k * 3) % FILES.length]
    if (out.some((f) => f.path === p)) continue
    out.push({ status: k === 2 && n.i % 5 === 0 ? 'A' : 'M', path: p, oldPath: null, additions: 3 + ((n.i + k) % 17), deletions: (n.i * k) % 9, binary: false })
  }
  // 60번째 커밋에서 auth.ts → login.ts 이름 변경
  if (n.i === 60) out.unshift({ status: 'R', path: 'src/lib/auth/login.ts', oldPath: 'src/lib/auth.ts', additions: 4, deletions: 2, binary: false })
  return out
}

function fakeDiff(path: string, seed: number, untracked = false): string {
  if (untracked) return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,4 @@\n+# 메모\n+\n+- 세션 만료 시간 확인\n+- 로그인 실패 횟수 제한\n`
  const base = 10 + (seed % 30)
  if (path.endsWith('Mapper.xml'))
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -9,8 +9,6 @@`,
      `       LEFT JOIN ORDER_ITEM ITM ON ITM.ORDER_ID = ORD.ORDER_ID`,
      `-     WHERE ORD.USE_YN = 'Y'`,
      `-    <if test="statusCd != null">`,
      `-       AND ORD.STATUS_CD = #{statusCd}`,
      `-    </if>`,
      `+    -- 테스트용: 조건 없이 전체 조회`,
      `+     WHERE 1 = 1`,
      `     <![CDATA[ AND ORD.ORDER_DT < SYSDATE - 30 ]]>`,
      `      GROUP BY ORD.ORDER_ID, ORD.STATUS_CD, ORD.AMOUNT`,
      `   </select>`,
      ``,
    ].join('\n')
  if (path.endsWith('.yml'))
    return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -4,4 +4,4 @@ spring:`, `     username: sample_app`, `     hikari:`, `-      maximum-pool-size: 20`, `+      maximum-pool-size: 40`, `   jpa:`, ``].join('\n')
  return [
    `diff --git a/${path} b/${path}`,
    `index ${hex(seed).slice(0, 7)}..${hex(seed + 1).slice(0, 7)} 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${base},7 +${base},9 @@ export function handle(input) {`,
    `   const value = input.trim()`,
    `   if (!value) return null`,
    `-  const result = parse(value, { strict: false })`,
    `+  const result = parse(value, { strict: true })`,
    `+  if (!result.ok) {`,
    `+    log.warn('입력을 해석하지 못했습니다', value)`,
    `+  }`,
    `-  return result`,
    `+  return result.ok ? result : null`,
    `   }`,
    ` `,
    `@@ -${base + 40},4 +${base + 42},4 @@ function format(date) {`,
    `-  return date.toISOString()`,
    `+  return date.toLocaleString('ko-KR')`,
    `   }`,
    ``,
  ].join('\n')
}

const blob = (text: string): TextBlob => ({ text, binary: false, truncated: false, encoding: 'utf-8', size: text.length })

/** 파일 종류에 맞는 예시 내용 (구문 강조 미리보기용) */
const sampleLines = (path: string): string[] => {
  if (path.endsWith('.yml'))
    return [`# ${path}`, `spring:`, `  datasource:`, `    url: jdbc:postgresql://db.example.com:5432/sample`, `    username: sample_app`, `    hikari:`, `      maximum-pool-size: 40`, `  jpa:`, `    open-in-view: false`, ``, `server:`, `  port: 8080`, `  servlet:`, `    session:`, `      cookie:`, `        secure: true`, `        http-only: true`, ``, `logging:`, `  level:`, `    root: warn`, `    com.example.sample: debug`]
  if (path.endsWith('Mapper.xml'))
    return [`<?xml version="1.0" encoding="UTF-8"?>`, `<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">`, `<mapper namespace="com.example.sample.order.OrderMapper">`, ``, `  <!-- 주문 목록: 상태와 기간으로 찾는다 -->`, `  <select id="selectOrders" parameterType="map" resultType="OrderVO">`, `    SELECT ORD.ORDER_ID, ORD.STATUS_CD, ORD.AMOUNT, COUNT(ITM.ITEM_ID) AS ITEM_CNT`, `      FROM ORDERS ORD`, `      LEFT JOIN ORDER_ITEM ITM ON ITM.ORDER_ID = ORD.ORDER_ID`, `     WHERE ORD.USE_YN = 'Y'`, `    <if test="statusCd != null">`, `       AND ORD.STATUS_CD = #{statusCd}`, `    </if>`, `    <![CDATA[ AND ORD.ORDER_DT < SYSDATE - 30 ]]>`, `     GROUP BY ORD.ORDER_ID, ORD.STATUS_CD, ORD.AMOUNT`, `  </select>`, `</mapper>`]
  if (path.endsWith('.java'))
    return [`package com.example.sample.order;`, ``, `import org.springframework.stereotype.Service;`, ``, `/**`, ` * 주문 조회`, ` * @author 예시`, ` */`, `@Service`, `public class OrderService {`, `    private final OrderMapper mapper;`, `    private static final int PAGE_SIZE = 20;`, ``, `    public OrderService(OrderMapper mapper) {`, `        this.mapper = mapper;`, `    }`, ``, `    public List<OrderVO> find(String statusCd) {`, `        if (statusCd == null) return List.of(); // 상태가 없으면 빈 목록`, `        return mapper.selectOrders(Map.of("statusCd", statusCd));`, `    }`, `}`]
  return [`// ${path}`, `import { parse } from './parser'`, `import { log } from './log'`, ``, `export function handle(input) {`, `  const value = input.trim()`, `  if (!value) return null`, `  const result = parse(value, { strict: true })`, `  if (!result.ok) {`, `    log.warn('입력을 해석하지 못했습니다', value)`, `  }`, `  return result.ok ? result : null`, `}`, ``, `export function format(date) {`, `  return date.toLocaleString('ko-KR')`, `}`]
}

let settings: Settings = {
  repos: [
    { path: 'C:/Project/sample-app', name: 'sample-app' },
    { path: 'C:/Project/api-server', name: 'api-server' },
  ],
  tabs: ['C:/Project/sample-app', 'C:/Project/api-server'],
  // ?tab=overview로 열면 요약 화면부터 (문서 스크린샷용)
  active: typeof location !== 'undefined' && new URLSearchParams(location.search).get('tab') === 'overview' ? '#overview' : 'C:/Project/sample-app',
  theme: 'system',
  fetchMinutes: 0,
  historyScope: 'all',
  diffMode: 'unified',
  ignoreWhitespace: false,
  editor: '',
  terminal: 'auto',
  sidebarWidth: 240,
  notifyEnabled: true,
  notifyCommit: true,
  notifyPush: true,
  notifyBranch: false,
  notifyWarn: true,
  notifyWhenFocused: false,
  closeToTray: true,
  startWithWindows: false,
  readOnly: false,
  pullMode: 'merge',
  commitPush: false,
}

const t0 = Date.now()
const workMtimes: Record<string, number> = {
  'src/lib/auth/login.ts': t0 - 3000,
  'src/lib/components/LoginForm.svelte': t0 - 45000,
  'docs/메모.md': t0 - 8 * 60000,
  'src/lib/api.ts': t0 - 20 * 60000,
}

const status = (root: string): Status =>
  root.includes('api')
    ? {
        root,
        branch: 'main',
        head: hex(602),
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
        state: null,
        staged: [],
        unstaged: [{ path: 'src/order/OrderController.java', oldPath: null, status: 'M', mtime: t0 - 4 * 60000 }],
        conflicted: [],
        truncated: false,
      }
    : sampleStatus(root)

/** 미리보기에서 조작(스테이지·커밋·push)으로 바뀌는 sample-app의 작업 트리 */
const work = {
  staged: [{ path: 'src/lib/api.ts', oldPath: null, status: 'M' }] as { path: string; oldPath: string | null; status: string }[],
  unstaged: [
    { path: 'src/lib/auth/login.ts', oldPath: null, status: 'M' },
    { path: 'src/lib/components/LoginForm.svelte', oldPath: null, status: 'M' },
    { path: 'server/src/main/resources/mapper/OrderMapper.xml', oldPath: null, status: 'M' },
    { path: 'docs/메모.md', oldPath: null, status: '?' },
  ] as { path: string; oldPath: string | null; status: string }[],
  /** 미리보기에서 만든 커밋 수 (push 대기에 더해진다) */
  commits: 0,
  pushed: false,
}

const sampleStatus = (root: string): Status => ({
  root,
  branch: 'main',
  head: main[99],
  upstream: 'origin/main',
  ahead: work.pushed ? 0 : 2 + work.commits,
  behind: root.includes('api') ? 1 : 0,
  state: null,
  staged: work.staged.map((f) => ({ ...f, mtime: workMtimes[f.path] ?? null })),
  unstaged: work.unstaged.map((f) => ({ ...f, mtime: workMtimes[f.path] ?? null })),
  conflicted: [],
  truncated: false,
})

/** 미리보기용 조작: 스테이지·커밋·push는 화면에 반영하고, 나머지는 흉내만 낸다 */
function mockOp(op: GitOp): string {
  const take = (list: typeof work.staged, paths: string[]) => {
    const moved = list.filter((f) => paths.includes(f.path))
    for (const f of moved) list.splice(list.indexOf(f), 1)
    return moved
  }
  switch (op.kind) {
    case 'stage':
      work.staged.push(...take(work.unstaged, op.paths).map((f) => ({ ...f, status: f.status === '?' ? 'A' : f.status })))
      return ''
    case 'unstage':
      work.unstaged.push(...take(work.staged, op.paths).map((f) => ({ ...f, status: f.status === 'A' ? '?' : f.status })))
      return ''
    case 'discard':
      take(work.unstaged, op.paths)
      if (op.staged) take(work.staged, op.paths)
      return ''
    case 'commit':
      if (!work.staged.length && !op.amend) throw new Error('nothing to commit, working tree clean')
      work.staged = []
      if (!op.amend) work.commits++
      work.pushed = false
      return `[main ${hex(2000 + work.commits).slice(0, 7)}] ${op.message.split(/\r?\n/)[0]}\n 1 file changed, 3 insertions(+), 1 deletion(-)`
    case 'push':
      work.pushed = true
      return `To https://github.com/example/sample-app.git\n   ${main[97].slice(0, 7)}..${main[99].slice(0, 7)}  main -> main`
    case 'pull':
      return 'Already up to date.'
    case 'merge':
      if (op.rev.includes('feature/login'))
        throw new Error(
          'Auto-merging src/lib/auth/login.ts\nCONFLICT (content): Merge conflict in src/lib/auth/login.ts\nAutomatic merge failed; fix conflicts and then commit the result.',
        )
      return `Merge made by the 'ort' strategy.`
    default:
      return `(미리보기) ${op.kind}: 실제 저장소는 바뀌지 않습니다`
  }
}

const refs = (): Refs => ({
  branches: [
    { name: 'main', sha: main[99], upstream: 'origin/main', ahead: 2, behind: 0, gone: false, time: byShaMap.get(main[99])!.time, subject: byShaMap.get(main[99])!.subject, current: true },
    { name: 'feature/login', sha: login[2], upstream: null, ahead: null, behind: null, gone: false, time: byShaMap.get(login[2])!.time, subject: byShaMap.get(login[2])!.subject, current: false },
    { name: 'feature/api', sha: feat[4], upstream: 'origin/feature/api', ahead: 0, behind: 0, gone: false, time: byShaMap.get(feat[4])!.time, subject: byShaMap.get(feat[4])!.subject, current: false },
  ],
  remotes: [
    {
      name: 'origin',
      url: 'https://github.com/example/sample-app.git',
      branches: [
        { name: 'origin/main', sha: main[97], time: byShaMap.get(main[97])!.time },
        { name: 'origin/feature/api', sha: feat[4], time: byShaMap.get(feat[4])!.time },
      ],
    },
  ],
  tags: [
    { name: 'v0.2.0', sha: main[70], time: byShaMap.get(main[70])!.time },
    { name: 'v0.1.0', sha: main[30], time: byShaMap.get(main[30])!.time },
  ],
  stashes: [{ index: 0, sha: hex(900), time: now - 7200, message: 'WIP on main: 실험 중인 정렬 옵션' }],
})

const outgoing = (all: boolean): OutgoingBranch[] => {
  const ahead = work.pushed ? [] : [main[99], main[98]].map((s) => toCommit(byShaMap.get(s)!))
  const files = [...filesOf(byShaMap.get(main[98])!), ...filesOf(byShaMap.get(main[99])!)].filter((f, i, a) => a.findIndex((x) => x.path === f.path) === i)
  const list: OutgoingBranch[] = [
    { branch: 'main', current: true, remote: 'origin', target: 'origin/main', newBranch: false, base: main[97], commits: ahead, files, behind: 0, truncated: false },
  ]
  if (all)
    list.push({
      branch: 'feature/login',
      current: false,
      remote: 'origin',
      target: 'origin/feature/login',
      newBranch: true,
      base: main[97],
      commits: [...login].reverse().map((s) => toCommit(byShaMap.get(s)!)),
      files: [
        { status: 'M', path: 'src/lib/auth/login.ts', oldPath: null, additions: 31, deletions: 4, binary: false },
        { status: 'A', path: 'src/lib/components/LoginForm.svelte', oldPath: null, additions: 88, deletions: 0, binary: false },
      ],
      behind: 0,
      truncated: false,
    })
  return list
}

const Z = '0'.repeat(40)
const activity = (): ActivityEntry[] => {
  const e = (min: number, refName: string, old: string, nw: string, message: string, dropped = 0): ActivityEntry => ({
    time: now - min * 60,
    refName,
    old,
    new: nw,
    message,
    who: 'Claude',
    subject: byShaMap.get(nw)?.subject ?? null,
    oldSubject: byShaMap.get(old)?.subject ?? (old === hex(950) ? '임시: 디버그 로그 추가' : null),
    dropped,
  })
  return [
    e(1, 'refs/heads/main', main[98], main[99], `commit: ${byShaMap.get(main[99])!.subject}`),
    e(9, 'refs/heads/main', main[97], main[98], `commit: ${byShaMap.get(main[98])!.subject}`),
    e(14, 'refs/heads/main', hex(950), main[97], 'reset: moving to HEAD~1', 1),
    e(15, 'refs/heads/main', main[97], hex(950), 'commit: 임시: 디버그 로그 추가'),
    e(22, 'refs/remotes/origin/main', main[96], main[97], 'update by push'),
    e(24, 'refs/heads/main', hex(951), main[97], `commit (amend): ${byShaMap.get(main[97])!.subject}`, 1),
    e(25, 'refs/heads/main', main[96], hex(951), `commit: ${byShaMap.get(main[97])!.subject}`),
    e(31, 'HEAD', login[2], main[96], 'checkout: moving from feature/login to main'),
    e(38, 'refs/heads/feature/login', login[1], login[2], `commit: ${byShaMap.get(login[2])!.subject}`),
    e(46, 'refs/heads/feature/login', login[0], login[1], `commit: ${byShaMap.get(login[1])!.subject}`),
    e(55, 'refs/heads/feature/login', Z, login[0], 'branch: Created from main'),
    e(70, 'refs/remotes/origin/main', main[95], main[96], 'fetch: fast-forward'),
    e(120, 'refs/heads/main', main[49], main[50], "merge feature/api: Merge made by the 'ort' strategy."),
    e(60 * 26, 'refs/remotes/origin/main', main[48], main[49], 'fetch: fast-forward'),
    e(60 * 24 * 3, 'refs/heads/main', main[47], main[48], `commit: ${byShaMap.get(main[48])!.subject}`),
  ]
}

/** 두 번째 샘플 저장소(api-server)의 활동 */
const apiActivity = (): ActivityEntry[] => {
  const e = (min: number, refName: string, old: string, nw: string, message: string, subject: string): ActivityEntry => ({
    time: now - min * 60,
    refName,
    old,
    new: nw,
    message,
    who: 'Claude',
    subject,
    oldSubject: null,
    dropped: 0,
  })
  return [
    e(4, 'refs/heads/main', hex(601), hex(602), 'commit: 주문 API 응답 시간 기록', '주문 API 응답 시간 기록'),
    e(18, 'refs/heads/main', hex(600), hex(601), 'commit: 결제 실패 재시도 횟수 설정', '결제 실패 재시도 횟수 설정'),
    e(52, 'refs/remotes/origin/main', hex(599), hex(600), 'update by push', '헬스 체크 경로 추가'),
    e(55, 'refs/heads/main', hex(599), hex(600), 'commit: 헬스 체크 경로 추가', '헬스 체크 경로 추가'),
  ]
}

function fileHistory(path: string): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const n of nodes) {
    let f = filesOf(n).find((x) => x.path === path)
    // 이름 변경 전 이력 (60번 커밋 이전의 auth.ts)
    if (!f && path === 'src/lib/auth/login.ts' && n.i < 60 && n.i % 6 === 0) f = { status: n.i === 0 ? 'A' : 'M', path: 'src/lib/auth.ts', oldPath: null, additions: 5, deletions: 2, binary: false }
    if (f) out.push({ commit: { ...toCommit(n), refs: [] }, path: f.path, oldPath: f.oldPath, status: f.status, additions: f.additions, deletions: f.deletions })
  }
  return out
}

function blame(path: string): Blame {
  const lines = sampleLines(path)
  const picks = [main[99], main[60], main[12], main[0]]
  const commits = picks.map((s) => {
    const n = byShaMap.get(s)!
    return { sha: s, author: AUTHORS[n.author][0], email: AUTHORS[n.author][1], time: n.time, summary: n.subject, path }
  })
  return { commits, lines: lines.map((text, i) => ({ c: i < 4 ? 3 : i < 7 ? 2 : i < 12 ? 0 : 1, origLine: i + 1, text })), encoding: 'utf-8' }
}

const delay = <T>(v: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(v), ms))

export function createMockBackend(): Backend {
  const listeners: ((c: RepoChange) => void)[] = []
  /** 미리보기 중에 "AI가 한" 새 커밋 */
  const live: ActivityEntry[] = []
  let tick = 0
  // AI가 파일을 고치고 가끔 커밋하는 것처럼 변경을 알린다
  setInterval(() => {
    tick++
    workMtimes['src/lib/auth/login.ts'] = Date.now()
    const git = tick % 3 === 0
    if (git) {
      const sha = hex(1000 + tick)
      live.unshift({ time: Math.floor(Date.now() / 1000), refName: 'refs/heads/main', old: main[99], new: sha, message: `commit: 미리보기 커밋 ${tick / 3}`, who: 'Claude', subject: `미리보기 커밋 ${tick / 3}`, oldSubject: null, dropped: 0 })
    }
    for (const l of listeners) l({ root: 'C:/Project/sample-app', worktree: true, git })
  }, 20000)

  return {
    isMock: true,
    appInfo: () => delay({ version: '0.1.0', gitPath: 'C:/Program Files/Git/cmd/git.exe', gitVersion: 'git version 2.50.1 (미리보기)', gitError: null, dataDir: '(브라우저 미리보기)' }),
    settingsGet: () => delay(structuredClone(settings)),
    async settingsSave(s) {
      settings = structuredClone(s)
    },
    repoResolve: (path) => delay({ root: path.replace(/\\/g, '/'), name: path.replace(/\\/g, '/').split('/').pop() || path }),
    status: (root) => delay(status(root)),
    refs: () => delay(refs()),
    async log(_root, q) {
      let list = nodes
      if (q.scope.kind === 'current') {
        const reach = new Set<string>()
        const stack = [main[99]]
        while (stack.length) {
          const s = stack.pop()!
          if (reach.has(s)) continue
          reach.add(s)
          stack.push(...(byShaMap.get(s)?.parents ?? []))
        }
        list = nodes.filter((n) => reach.has(n.sha))
      }
      if (q.message) list = list.filter((n) => n.subject.toLowerCase().includes(q.message!.toLowerCase()))
      return delay(list.slice(q.skip, q.skip + q.limit).map(toCommit), 120)
    },
    async commit(_root, sha): Promise<CommitDetail> {
      const n = byShaMap.get(sha) ?? { sha, parents: [main[96]], author: 1, time: now - 900, subject: '임시: 디버그 로그 추가', i: 7 }
      const a = AUTHORS[n.author]
      return delay({
        sha: n.sha,
        parents: n.parents,
        author: a[0],
        email: a[1],
        time: n.time,
        committer: a[0],
        committerEmail: a[1],
        commitTime: n.time,
        message: `${n.subject}\n\n- 변경 이유를 적은 본문 예시입니다.\n- 관련 화면도 같이 고쳤습니다.`,
        files: filesOf(n as Node),
      })
    },
    commitBranches: () => delay(['main', 'origin/main']),
    async diff(_root, target) {
      if (target.kind === 'worktree') return delay(blob(fakeDiff(target.path, 3, target.untracked)))
      const path = 'path' in target ? target.path : target.bPath
      const seed = 'sha' in target ? (byShaMap.get(target.sha)?.i ?? 1) : 5
      return delay(blob(fakeDiff(path, seed)))
    },
    outgoing: (_root, all) => delay(outgoing(all), 150),
    activity: (root) => delay(root.includes('api') ? apiActivity() : [...live, ...activity()]),
    fileHistory: (_root, path, _follow, skip, limit) => delay(fileHistory(path).slice(skip, skip + limit)),
    blame: (_root, path) => delay(blame(path)),
    fileContent: (_root, path) => delay(blob(sampleLines(path).join('\n') + '\n')),
    lineHistory: (_root, path) =>
      delay([
        { commit: toCommit(byShaMap.get(main[99])!), diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -8,1 +8,1 @@\n-  const result = parse(value, { strict: false })\n+  const result = parse(value, { strict: true })\n` },
        { commit: toCommit(byShaMap.get(main[12])!), diff: `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +8,1 @@\n+  const result = parse(value, { strict: false })\n` },
      ]),
    files: () => delay([...FILES, 'docs/메모.md'].sort()),
    fetch: () => delay('', 700),
    async op(root, op) {
      await delay(null, op.kind === 'push' || op.kind === 'pull' ? 900 : 200)
      const out = mockOp(op)
      setTimeout(() => {
        for (const l of listeners) l({ root, worktree: true, git: true })
      }, 50)
      return out
    },
    watch: () => delay([]),
    async onChanged(cb) {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i !== -1) listeners.splice(i, 1)
      }
    },
    async openPath(p) {
      console.info('열기', p)
    },
    async revealPath(p) {
      console.info('탐색기', p)
    },
    async openTerminal(p) {
      console.info('터미널', p)
    },
    async openEditor(p) {
      console.info('편집기', p)
    },
    pickFolder: () => delay('C:/Project/sample-app'),
    async notify(title, body) {
      // 브라우저 미리보기: 브라우저 알림을 허락했으면 그것으로, 아니면 콘솔에
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body })
      else console.info('[알림]', title, body)
    },
    async trayUpdate(summary) {
      document.title = summary.tooltip
    },
    async onTray() {
      return () => {}
    },
    async windowShow() {},
  }
}
