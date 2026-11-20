// 앱 상태: 열린 저장소 탭과 탭마다의 화면 상태

import { createBackend, errorMessage, type Backend } from './api'
import { describe, newSince } from './activity'
import { buildNotices } from './notify'
import type { TraySummary } from './tray'
import type { ActivityEntry, AppInfo, Commit, OutgoingBranch, Refs, RepoChange, Settings, Status } from './types'
import type { MenuEntry } from './components/ContextMenu.svelte'

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
  private logSeq = 0
  private loadedOnce = false

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
    const skip = reset ? 0 : this.commits.length
    const limit = reset ? Math.max(PAGE, Math.min(this.commits.length, 5000)) : PAGE
    try {
      const list = await app.backend.log(this.root, {
        scope: { kind: this.scope },
        skip,
        limit,
        message: this.search.trim() || null,
      })
      if (seq !== this.logSeq) return
      this.commits = reset ? list : [...this.commits, ...list]
      this.logDone = list.length < limit
      if (reset && this.selected && !list.some((c) => c.sha === this.selected)) {
        // 고른 커밋이 사라졌으면(amend·reset) 맨 위를 고른다
        this.selected = list[0]?.sha ?? null
      }
      if (!this.selected && list.length) this.selected = list[0].sha
    } catch (e) {
      if (seq === this.logSeq) app.toast(`${this.name}: ${errorMessage(e)}`, 'error')
    } finally {
      if (seq === this.logSeq) this.logLoading = false
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
      if (!notify || !fresh.length) return
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

  ensureLoaded() {
    if (!this.loadedOnce) void this.refreshAll()
  }

  /** 감시가 알려 준 변화 */
  async onChange(c: RepoChange) {
    this.pulse = Date.now()
    const tasks: Promise<unknown>[] = [this.refreshStatus()]
    if (c.git) {
      tasks.push(this.refreshActivity(true))
      if (this.loadedOnce) tasks.push(this.refreshRefs(), this.loadLog(true))
      // 요약 화면에서 읽은 뒤쪽 탭의 push 대기도 계속 맞춘다
      if (this.loadedOnce || this.outgoing) tasks.push(this.refreshOutgoing())
    }
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
  settingsOpen = $state(false)
  menu = $state<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  private toastId = 0
  private fetchTimer: ReturnType<typeof setInterval> | null = null
  private trayTimer: ReturnType<typeof setTimeout> | undefined

  get active(): Repo | null {
    return this.tabs.find((t) => t.root === this.activeRoot) ?? null
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
    for (const root of this.settings.tabs) {
      const entry = this.settings.repos.find((r) => r.path === root)
      this.tabs.push(new Repo(root, entry?.name ?? root.split('/').pop() ?? root, this.settings.historyScope))
    }
    const saved = this.settings.active
    this.activeRoot = this.tabs.some((t) => t.root === saved) || (saved === OVERVIEW && this.tabs.length) ? saved : (this.tabs[0]?.root ?? null)
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
