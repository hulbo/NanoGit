// 앱 상태: 열린 저장소 탭과 탭마다의 화면 상태

import { createBackend, errorMessage, type Backend } from './api'
import { describe, newSince } from './activity'
import { buildNotices } from './notify'
import type { TraySummary } from './tray'
import type { ActivityEntry, AppInfo, Author, Commit, GitOp, UpdateInfo, OutgoingBranch, Refs, RepoChange, Settings, Status } from './types'
import type { MenuEntry } from './components/ContextMenu.svelte'
import type { DialogSpec, DialogValues } from './dialog'

export type View = 'status' | 'history' | 'activity' | 'outgoing' | 'files' | 'fileHistory'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'warn'
  text: string
  action?: { label: string; run: () => void }
}

const PAGE = 500

/** 요약 화면을 고른 상태의 activeRoot (저장소 경로와 겹치지 않는 값) */
export const OVERVIEW = '#overview'

export const DEFAULT_SETTINGS: Settings = {
  repos: [],
  tabs: [],
  active: null,
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
  autoUpdate: true,
}

/** 파일 이력 화면을 여는 요청 */
export interface FileHistoryTarget {
  path: string
  /** 처음 고를 커밋 */
  rev?: string | null
  tab?: 'diff' | 'content' | 'blame' | 'worktree'
}

export class Repo {
  readonly root: string
  readonly name: string
  status = $state<Status | null>(null)
  refs = $state<Refs | null>(null)
  error = $state<string | null>(null)
  view = $state<View>('history')

  commits = $state.raw<Commit[]>([])
  logDone = $state(false)
  logLoading = $state(false)
  scope = $state<'all' | 'current'>('all')
  search = $state('')
  /** 이 작성자(이름)의 커밋만. '' = 모두 */
  author = $state('')
  /** F5·툴바 새로고침 중 */
  refreshing = $state(false)
  /** 작성자 고르기 목록 (처음 히스토리를 볼 때 읽는다) */
  authors = $state.raw<Author[] | null>(null)
  /** 히스토리에서 고른 커밋 */
  selected = $state<string | null>(null)

  outgoing = $state.raw<OutgoingBranch[] | null>(null)
  outgoingAll = $state(false)
  outgoingLoading = $state(false)

  activity = $state.raw<ActivityEntry[] | null>(null)
  /** 마지막으로 확인한 활동 (새 활동 알림 기준) */
  private lastSeen: ActivityEntry | null = null
  /** 아직 보지 않은 새 활동 수 */
  unseen = $state(0)

  fileHistory = $state<FileHistoryTarget | null>(null)
  /** 마지막으로 변화를 감지한 시각(ms): 탭의 깜빡이는 점 */
  pulse = $state(0)
  /** 진행 중인 조작 이름 (커밋, push …) */
  busy = $state<string | null>(null)
  /** 인덱스(스테이지)가 바뀔 때마다 올라가는 번호: 파일 상태의 diff를 다시 읽는 기준 */
  indexSeq = $state(0)
  /** 커밋 메시지 초안 */
  draft = $state('')
  amend = $state(false)
  private logSeq = 0
  /** 지금까지 읽은 git log 결과 수 (다음 쪽의 skip. ID로 찾은 커밋은 세지 않는다) */
  private logSkip = 0
  /** 마지막으로 읽은 검색어 */
  private foundFor = ''
  private authorsStale = false
  private authorsLoading = false
  private loadedOnce = false
  /** 내가 한 조작이 활동에 남긴 기록은 새 활동으로 알리지 않는다 (이 시각까지) */
  private quietUntil = 0

  constructor(root: string, name: string, scope: 'all' | 'current') {
    this.root = root
    this.name = name
    this.scope = scope
  }

  get changeCount(): number {
    const s = this.status
    if (!s) return 0
    const paths = new Set<string>()
    for (const f of [...s.staged, ...s.unstaged, ...s.conflicted]) paths.add(f.path)
    return paths.size
  }

  /** push 대기 커밋 수 (추적 브랜치 기준. 없으면 push 대기 화면에서 계산한 값) */
  get aheadCount(): number {
    const cur = this.outgoing?.find((o) => o.current)
    // 원격이 없으면 올릴 곳이 없으므로 push 대기로 세지 않는다 (Push 대기 화면에는 "원격 없음"으로 보인다)
    if (cur) return cur.remote ? cur.commits.length : 0
    return this.status?.ahead ?? 0
  }

  /** 아직 push하지 않은 커밋 (현재 브랜치) */
  get unpushed(): Set<string> {
    return new Set(this.outgoing?.find((o) => o.current)?.commits.map((c) => c.sha) ?? [])
  }

  async refreshStatus() {
    try {
      this.status = await app.backend.status(this.root)
      this.error = null
    } catch (e) {
      this.error = errorMessage(e)
    }
  }

  async refreshRefs() {
    try {
      this.refs = await app.backend.refs(this.root)
    } catch (e) {
      app.toast(`${this.name}: ${errorMessage(e)}`, 'error')
    }
  }

  async loadLog(reset = true) {
    const seq = ++this.logSeq
    this.logLoading = true
    const skip = reset ? 0 : this.logSkip
    const limit = reset ? Math.max(PAGE, Math.min(this.logSkip, 5000)) : PAGE
    const search = this.search.trim()
    const author = this.author
    try {
      const [list, hits] = await Promise.all([
        app.backend.log(this.root, {
          scope: { kind: this.scope },
          skip,
          limit,
          message: search || null,
          // git은 "이름 <메일>"에서 찾으므로 " <"까지 붙여 이름이 같은 사람만
          author: author ? `${author} <` : null,
        }),
        // 검색어가 커밋 ID·브랜치·태그면 그 커밋도 맨 위에
        reset && search ? app.backend.findCommits(this.root, search).catch(() => [] as Commit[]) : Promise.resolve([] as Commit[]),
      ])
      if (seq !== this.logSeq) return
      const found = hits.filter((c) => !author || c.author === author)
      const base = reset ? found : this.commits
      const seen = new Set(base.map((c) => c.sha))
      this.commits = [...base, ...list.filter((c) => !seen.has(c.sha))]
      this.logSkip = skip + list.length
      this.logDone = list.length < limit
      // 새로 검색해서 ID로 찾았으면 그 커밋을 고른다 (같은 검색으로 다시 읽을 때는 고른 것을 둔다)
      if (reset && found.length && search !== this.foundFor) this.selected = found[0].sha
      if (reset) this.foundFor = search
      if (reset && this.selected && !this.commits.some((c) => c.sha === this.selected)) {
        // 고른 커밋이 사라졌으면(amend·reset, 검색) 맨 위를 고른다
        this.selected = this.commits[0]?.sha ?? null
      }
      if (!this.selected && this.commits.length) this.selected = this.commits[0].sha
    } catch (e) {
      if (seq === this.logSeq) app.toast(`${this.name}: ${errorMessage(e)}`, 'error')
    } finally {
      if (seq === this.logSeq) this.logLoading = false
    }
  }

  /** 작성자 목록 (처음이거나 커밋이 바뀐 뒤에만 다시 읽는다) */
  async loadAuthors(force = false) {
    if (this.authorsLoading || (this.authors && !this.authorsStale && !force)) return
    this.authorsLoading = true
    try {
      this.authors = await app.backend.authors(this.root)
      this.authorsStale = false
    } catch (e) {
      app.toast(`${this.name}: ${errorMessage(e)}`, 'error')
    } finally {
      this.authorsLoading = false
    }
  }

  async loadMore() {
    if (this.logDone || this.logLoading) return
    await this.loadLog(false)
  }

  async refreshOutgoing() {
    this.outgoingLoading = true
    try {
      this.outgoing = await app.backend.outgoing(this.root, this.outgoingAll)
    } catch (e) {
      app.toast(`${this.name}: ${errorMessage(e)}`, 'error')
    } finally {
      this.outgoingLoading = false
    }
  }

  /** 활동을 다시 읽고, 처음이 아니면 새 활동을 알린다 */
  async refreshActivity(notify: boolean) {
    try {
      const list = await app.backend.activity(this.root, 300)
      const fresh = newSince(list, this.lastSeen)
      this.activity = list
      if (list.length) this.lastSeen = list[0]
      if (!notify || !fresh.length || this.busy || Date.now() < this.quietUntil) return
      if (!(app.active === this && this.view === 'activity')) this.unseen += fresh.length
      void app.notifyActivity(this, fresh)
      for (const e of fresh.slice(0, 3).reverse()) {
        const v = describe(e)
        const kind = v.severity === 'danger' ? 'error' : v.severity === 'caution' ? 'warn' : 'info'
        app.toast(`${this.name} · ${v.label}: ${v.title}${v.note ? ` — ${v.note}` : ''}`, kind, {
          label: '보기',
          run: () => {
            app.select(this.root)
            this.setView('activity')
          },
        })
      }
    } catch {
      // reflog를 읽지 못해도 다른 화면은 그대로 쓴다
    }
  }

  /** 처음 열 때 또는 F5 */
  async refreshAll() {
    this.loadedOnce = true
    await Promise.all([this.refreshStatus(), this.refreshRefs(), this.loadLog(true), this.refreshActivity(false), this.refreshOutgoing()])
  }

  /** 사용자가 고른 새로고침 (F5·툴바): 보이는 diff·작성자 목록까지 다시 읽고, 도는 동안 툴바 아이콘이 돈다 */
  async refreshNow() {
    if (this.refreshing) return
    this.refreshing = true
    this.indexSeq++
    this.authorsStale = true
    const started = Date.now()
    try {
      await Promise.all([this.refreshAll(), this.authors ? this.loadAuthors() : null])
    } finally {
      // 너무 빨리 끝나도 돈 것이 보이게
      setTimeout(() => (this.refreshing = false), Math.max(0, 400 - (Date.now() - started)))
    }
  }

  ensureLoaded() {
    if (!this.loadedOnce) void this.refreshAll()
  }

  /** 감시가 알려 준 변화 */
  async onChange(c: RepoChange) {
    this.pulse = Date.now()
    const tasks: Promise<unknown>[] = [this.refreshStatus()]
    if (c.git) {
      this.indexSeq++
      this.authorsStale = true
      tasks.push(this.refreshActivity(true))
      if (this.loadedOnce) tasks.push(this.refreshRefs(), this.loadLog(true))
      // 요약 화면에서 읽은 뒤쪽 탭의 push 대기도 계속 맞춘다
      if (this.loadedOnce || this.outgoing) tasks.push(this.refreshOutgoing())
    }
    await Promise.all(tasks)
  }

  /**
   * 조작 실행: 진행 표시, 끝나면 화면을 다시 읽고, 실패하면 git이 남긴 글을 보여 준다.
   * 성공하면 git 출력, 실패하면 null. `done`은 성공 알림 글 (null이면 알리지 않음)
   */
  async run(op: GitOp, label: string, done: string | null | ((out: string) => string | null) = null): Promise<string | null> {
    if (this.busy) {
      app.toast(`${this.name}: ${this.busy} 중입니다. 끝난 뒤 다시 해 보세요`, 'warn')
      return null
    }
    this.busy = label
    try {
      const out = await app.backend.op(this.root, op)
      const msg = typeof done === 'function' ? done(out) : done
      if (msg) app.toast(`${this.name}: ${msg}`, 'success', out.trim() ? { label: 'git 출력', run: () => app.showOutput(label, out) } : undefined)
      return out
    } catch (e) {
      const text = errorMessage(e)
      // 알림에는 가장 중요한 한 줄 (오류·충돌 줄, 없으면 첫 줄)
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      const first = lines.find((l) => /^(fatal|error|CONFLICT|!\s*\[rejected\])/i.test(l)) ?? lines[0] ?? text
      app.toast(`${this.name}: ${label} 실패 — ${first.length > 120 ? `${first.slice(0, 120)}…` : first}`, 'error', {
        label: '자세히',
        run: () => app.showOutput(`${label} 실패`, text),
      })
      return null
    } finally {
      this.busy = null
      this.quietUntil = Date.now() + 2500
      await this.afterOp()
    }
  }

  /** 조작 뒤 화면을 바로 맞춘다 (감시 알림을 기다리지 않고) */
  private async afterOp() {
    this.indexSeq++
    const tasks: Promise<unknown>[] = [this.refreshStatus(), this.refreshRefs(), this.refreshActivity(false)]
    if (this.loadedOnce) tasks.push(this.loadLog(true))
    if (this.loadedOnce || this.outgoing) tasks.push(this.refreshOutgoing())
    await Promise.all(tasks)
  }

  setView(v: View) {
    this.view = v
    if (v === 'activity') this.unseen = 0
    if (v === 'outgoing' && !this.outgoing) void this.refreshOutgoing()
  }

  openFileHistory(t: FileHistoryTarget) {
    this.fileHistory = t
    this.setView('fileHistory')
  }

  /** 히스토리에서 커밋으로 이동 */
  async reveal(sha: string) {
    this.setView('history')
    this.selected = sha
    if (!this.commits.some((c) => c.sha === sha)) {
      // 아직 읽지 않은 범위면 더 읽는다 (최대 몇 번)
      for (let i = 0; i < 10 && !this.logDone && !this.commits.some((c) => c.sha === sha); i++) await this.loadMore()
    }
  }
}

class App {
  backend!: Backend
  ready = $state(false)
  info = $state<AppInfo | null>(null)
  settings = $state<Settings>({ ...DEFAULT_SETTINGS })
  tabs = $state<Repo[]>([])
  activeRoot = $state<string | null>(null)
  toasts = $state<Toast[]>([])
  quickOpen = $state(false)
  /** 새 버전 (없으면 null) */
  update = $state<UpdateInfo | null>(null)
  /** 새 버전을 받는 중: 0~1, 전체 크기를 모르면 -1. 받지 않을 때 null */
  updateProgress = $state<number | null>(null)
  settingsOpen = $state(false)
  menu = $state<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  /** 열려 있는 조작 대화상자 */
  dialog = $state<{ spec: DialogSpec; resolve: (v: DialogValues | null) => void } | null>(null)
  /** 커밋 입력란으로 가라는 신호 (툴바의 커밋 버튼) */
  commitFocus = $state(0)
  private toastId = 0
  private fetchTimer: ReturnType<typeof setInterval> | null = null
  private updateTimer: ReturnType<typeof setTimeout> | null = null
  private trayTimer: ReturnType<typeof setTimeout> | undefined

  get active(): Repo | null {
    return this.tabs.find((t) => t.root === this.activeRoot) ?? null
  }

  /** 저장소를 바꾸는 조작을 보여 줄지 (감시 전용 모드가 아니면) */
  get canWrite(): boolean {
    return !this.settings.readOnly
  }

  /** 요약 화면을 보고 있음 */
  get onOverview(): boolean {
    return this.activeRoot === OVERVIEW && this.tabs.length > 0
  }

  async init() {
    this.backend = await createBackend()
    try {
      this.info = await this.backend.appInfo()
      this.settings = { ...DEFAULT_SETTINGS, ...(await this.backend.settingsGet()) }
    } catch (e) {
      this.toast(errorMessage(e), 'error')
    }
    if (this.info?.gitError) this.toast(this.info.gitError, 'error')
    if (this.info?.updatedFrom) this.toast(`NanoGit ${this.info.version}로 업데이트했습니다 (전 버전 ${this.info.updatedFrom})`, 'success')
    for (const root of this.settings.tabs) {
      const entry = this.settings.repos.find((r) => r.path === root)
      this.tabs.push(new Repo(root, entry?.name ?? root.split('/').pop() ?? root, this.settings.historyScope))
    }
    const saved = this.settings.active
    this.activeRoot = this.tabs.some((t) => t.root === saved) || (saved === OVERVIEW && this.tabs.length) ? saved : (this.tabs[0]?.root ?? null)
    // 브라우저 미리보기: ?view=status로 처음 화면을 고른다 (문서 스크린샷용)
    const firstView = this.backend.isMock ? new URLSearchParams(location.search).get('view') : null
    if (firstView && this.active) this.active.view = firstView as View
    await this.backend.onChanged((c) => {
      const repo = this.tabs.find((t) => t.root.toLowerCase() === c.root.toLowerCase())
      if (repo) void repo.onChange(c)
    })
    await this.backend.onTray((a) => {
      if (a.kind === 'openRepo') {
        if (this.tabs.some((t) => t.root === a.root)) this.select(a.root)
      } else if (a.kind === 'toggleNotify') {
        this.settings.notifyEnabled = !this.settings.notifyEnabled
        void this.persist()
        this.toast(this.settings.notifyEnabled ? '알림을 켰습니다' : '알림을 껐습니다 (트레이 메뉴나 설정에서 다시 켤 수 있습니다)', 'info')
      } else if (a.kind === 'fetchAll') {
        void this.fetchAll(false)
      }
    })
    await this.syncWatch()
    // 백그라운드 탭도 배지(변경 수·push 대기)를 보여 주도록 상태만 읽는다
    for (const t of this.tabs) {
      if (t.root === this.activeRoot) t.ensureLoaded()
      else {
        void t.refreshStatus()
        void t.refreshActivity(false)
      }
    }
    this.applyTheme()
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => this.applyTheme())
    this.setupFetchTimer()
    this.setupUpdateTimer()
    this.ready = true
  }

  applyTheme() {
    const t = this.settings.theme
    const light = window.matchMedia('(prefers-color-scheme: light)').matches
    document.documentElement.setAttribute('data-theme', t === 'system' ? (light ? 'light' : 'dark') : t)
  }

  setupFetchTimer() {
    if (this.fetchTimer) clearInterval(this.fetchTimer)
    this.fetchTimer = null
    const min = this.settings.fetchMinutes
    if (min > 0) this.fetchTimer = setInterval(() => void this.fetchAll(true), min * 60000)
  }

  /** 새 버전 자동 확인: 켠 뒤 잠시 있다가, 그다음 6시간마다 (트레이에 오래 떠 있으므로) */
  setupUpdateTimer() {
    if (this.updateTimer) clearTimeout(this.updateTimer)
    this.updateTimer = null
    if (!this.settings.autoUpdate) return
    const next = (ms: number) => {
      this.updateTimer = setTimeout(async () => {
        await this.checkUpdate(false)
        next(6 * 3600_000)
      }, ms)
    }
    next(15_000)
  }

  /** 새 버전 확인. manual이면 결과(최신·실패)도 알린다 */
  async checkUpdate(manual: boolean) {
    try {
      const u = await this.backend.updateCheck()
      const fresh = !!u && u.version !== this.update?.version
      this.update = u
      if (u && (manual || fresh)) {
        this.toast(`새 버전이 있습니다: NanoGit ${u.version} (지금 ${u.current})`, 'info', { label: '업데이트', run: () => void this.installUpdate() })
      } else if (!u && manual) {
        this.toast(`최신 버전입니다 (NanoGit ${this.info?.version ?? ''})`, 'success')
      }
    } catch (e) {
      if (manual) this.toast(errorMessage(e), 'error')
    }
  }

  /** 새 버전을 받아 설치한다. 확인을 받고, 받는 동안 상태 표시줄에 진행률을 보인다 */
  async installUpdate() {
    const u = this.update
    if (!u || this.updateProgress !== null) return
    const notes = (u.notes ?? '').replace(/\*\*|`/g, '').replace(/^#+\s*/gm, '').trim()
    const fields: DialogSpec['fields'] = [
      { kind: 'info', text: `NanoGit ${u.current} → ${u.version}. 받아서 설치하면 NanoGit이 잠시 닫혔다가 다시 켜지고, 감시도 이어서 합니다.` },
    ]
    if (notes) fields.push({ kind: 'output', text: notes })
    const ok = await this.ask({ title: `NanoGit ${u.version}로 업데이트`, icon: 'pull', fields, ok: '업데이트' })
    if (!ok) return
    this.updateProgress = 0
    try {
      await this.backend.updateInstall((got, total) => (this.updateProgress = total ? Math.min(1, got / total) : -1))
    } catch (e) {
      this.toast(errorMessage(e), 'error')
    } finally {
      this.updateProgress = null
    }
  }

  async fetchAll(quiet: boolean) {
    for (const t of this.tabs) await this.fetch(t, quiet)
  }

  async fetch(repo: Repo, quiet = false) {
    try {
      await this.backend.fetch(repo.root)
      if (!quiet) this.toast(`${repo.name}: 원격을 가져왔습니다`, 'success')
      await repo.onChange({ root: repo.root, worktree: false, git: true })
    } catch (e) {
      if (!quiet) this.toast(`${repo.name}: fetch 실패 — ${errorMessage(e)}`, 'error')
    }
  }

  async syncWatch() {
    try {
      const errors = await this.backend.watch(this.tabs.map((t) => t.root))
      for (const e of errors) this.toast(`감시를 시작하지 못했습니다: ${e}`, 'warn')
    } catch (e) {
      this.toast(errorMessage(e), 'error')
    }
  }

  async addRepo(path?: string | null) {
    const picked = path ?? (await this.backend.pickFolder())
    if (!picked) return
    try {
      const { root, name } = await this.backend.repoResolve(picked)
      const existing = this.tabs.find((t) => t.root.toLowerCase() === root.toLowerCase())
      if (existing) {
        this.select(existing.root)
        return
      }
      const repo = new Repo(root, name, this.settings.historyScope)
      this.tabs.push(repo)
      this.settings.repos = [{ path: root, name }, ...this.settings.repos.filter((r) => r.path.toLowerCase() !== root.toLowerCase())].slice(0, 30)
      this.select(root)
      await this.syncWatch()
    } catch (e) {
      this.toast(errorMessage(e), 'error')
    }
  }

  select(root: string) {
    this.activeRoot = root
    this.active?.ensureLoaded()
    void this.persist()
  }

  async closeTab(root: string) {
    const i = this.tabs.findIndex((t) => t.root === root)
    if (i === -1) return
    this.tabs.splice(i, 1)
    if (this.activeRoot === root) this.activeRoot = this.tabs[Math.min(i, this.tabs.length - 1)]?.root ?? null
    this.active?.ensureLoaded()
    await this.syncWatch()
    void this.persist()
  }

  /** 요약 → 첫 탭 → … → 마지막 탭 → 요약 순서로 돈다 */
  moveTab(delta: number) {
    const seq = [OVERVIEW, ...this.tabs.map((t) => t.root)]
    if (seq.length < 2) return
    const i = Math.max(0, seq.indexOf(this.activeRoot ?? ''))
    this.select(seq[(i + delta + seq.length) % seq.length])
  }

  forgetRepo(path: string) {
    this.settings.repos = this.settings.repos.filter((r) => r.path !== path)
    void this.persist()
  }

  /** 설정 저장. 실패하면 알리고 false */
  async persist(): Promise<boolean> {
    this.settings.tabs = this.tabs.map((t) => t.root)
    this.settings.active = this.activeRoot
    try {
      await this.backend.settingsSave($state.snapshot(this.settings))
      return true
    } catch (e) {
      this.toast(errorMessage(e), 'error')
      return false
    }
  }

  /** 트레이 툴팁·메뉴를 갱신한다 (몰아서 한 번) */
  queueTray(summary: TraySummary) {
    clearTimeout(this.trayTimer)
    this.trayTimer = setTimeout(() => {
      this.backend?.trayUpdate(summary).catch(() => {})
    }, 300)
  }

  /** 새 활동을 Windows 알림으로 (앱을 보고 있으면 앱 안의 알림만) */
  async notifyActivity(repo: Repo, fresh: ActivityEntry[]) {
    const s = this.settings
    if (!s.notifyEnabled) return
    if (!s.notifyWhenFocused && document.hasFocus()) return
    for (const n of buildNotices(repo.name, fresh, s)) {
      try {
        await this.backend.notify(n.title, n.body)
      } catch (e) {
        console.warn(errorMessage(e))
        return
      }
    }
  }

  async testNotify() {
    try {
      await this.backend.notify('NanoGit · 알림 시험', 'AI가 커밋·push하거나 reset 같은 작업을 하면 이렇게 알려 드립니다.')
    } catch (e) {
      this.toast(errorMessage(e), 'error')
    }
  }

  /** 대화상자를 열고 확인하면 입력값, 취소하면 null */
  ask(spec: DialogSpec): Promise<DialogValues | null> {
    this.dialog?.resolve(null)
    return new Promise((resolve) => {
      this.dialog = {
        spec,
        resolve: (v) => {
          this.dialog = null
          resolve(v)
        },
      }
    })
  }

  async confirm(title: string, text: string, opts: { ok?: string; danger?: boolean; items?: string[] } = {}): Promise<boolean> {
    const fields: DialogSpec['fields'] = [{ kind: 'info', text }]
    if (opts.items?.length) fields.push({ kind: 'list', items: opts.items })
    return (await this.ask({ title, fields, ok: opts.ok, danger: opts.danger })) !== null
  }

  /** git이 남긴 글 보기 */
  showOutput(title: string, text: string) {
    void this.ask({ title, icon: 'terminal', fields: [{ kind: 'output', text: text.trim() || '(출력 없음)' }], ok: '닫기', cancel: null })
  }

  toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
    const id = ++this.toastId
    this.toasts.push({ id, kind, text, action })
    if (this.toasts.length > 5) this.toasts.splice(0, this.toasts.length - 5)
    const ms = kind === 'error' ? 12000 : kind === 'warn' ? 9000 : 5000
    setTimeout(() => this.dismiss(id), ms)
  }

  dismiss(id: number) {
    const i = this.toasts.findIndex((t) => t.id === id)
    if (i !== -1) this.toasts.splice(i, 1)
  }

  async copy(text: string, what = '') {
    try {
      await navigator.clipboard.writeText(text)
      this.toast(`${what ? `${what} ` : ''}복사했습니다: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`, 'success')
    } catch (e) {
      this.toast(errorMessage(e), 'error')
    }
  }

  async run(task: () => Promise<unknown>) {
    try {
      await task()
    } catch (e) {
      this.toast(errorMessage(e), 'error')
    }
  }

  openMenu(e: MouseEvent, items: MenuEntry[]) {
    e.preventDefault()
    e.stopPropagation()
    this.menu = { x: e.clientX, y: e.clientY, items }
  }
}

export const app = new App()
