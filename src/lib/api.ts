// 백엔드 호출 계층.
// Tauri 앱 안에서는 Rust 명령을 호출하고, 일반 브라우저(개발 미리보기)에서는 가짜 백엔드를 쓴다.

import type {
  ActivityEntry,
  AppInfo,
  Blame,
  Commit,
  CommitDetail,
  DiffOptions,
  DiffTarget,
  HistoryEntry,
  LineHistoryEntry,
  LogQuery,
  OutgoingBranch,
  Refs,
  RepoChange,
  Settings,
  Status,
  TextBlob,
} from './types'

export interface Backend {
  readonly isMock: boolean
  appInfo(): Promise<AppInfo>
  settingsGet(): Promise<Settings>
  settingsSave(settings: Settings): Promise<void>
  /** 고른 폴더에서 저장소 루트를 찾는다 */
  repoResolve(path: string): Promise<{ root: string; name: string }>
  status(root: string): Promise<Status>
  refs(root: string): Promise<Refs>
  log(root: string, query: LogQuery): Promise<Commit[]>
  commit(root: string, sha: string): Promise<CommitDetail>
  commitBranches(root: string, sha: string): Promise<string[]>
  diff(root: string, target: DiffTarget, options?: DiffOptions): Promise<TextBlob>
  outgoing(root: string, all: boolean): Promise<OutgoingBranch[]>
  activity(root: string, limit?: number): Promise<ActivityEntry[]>
  fileHistory(root: string, path: string, follow: boolean, skip: number, limit: number, rev?: string | null): Promise<HistoryEntry[]>
  blame(root: string, path: string, rev?: string | null): Promise<Blame>
  fileContent(root: string, path: string, rev?: string | null): Promise<TextBlob>
  lineHistory(root: string, path: string, start: number, end: number, rev?: string | null): Promise<LineHistoryEntry[]>
  files(root: string, rev?: string | null): Promise<string[]>
  fetch(root: string): Promise<string>
  /** 감시할 저장소 목록. 감시를 시작하지 못한 저장소의 오류를 돌려준다 */
  watch(roots: string[]): Promise<string[]>
  onChanged(cb: (c: RepoChange) => void): Promise<() => void>
  openPath(path: string): Promise<void>
  revealPath(path: string): Promise<void>
  openTerminal(root: string): Promise<void>
  openEditor(path: string): Promise<void>
  pickFolder(): Promise<string | null>
  /** Windows 알림 */
  notify(title: string, body: string): Promise<void>
}

export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return JSON.stringify(e)
}

async function createTauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core')
  const { listen } = await import('@tauri-apps/api/event')
  const dialog = await import('@tauri-apps/plugin-dialog')

  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await invoke<T>(cmd, args)
    } catch (e) {
      throw new Error(errorMessage(e))
    }
  }

  return {
    isMock: false,
    appInfo: () => call('app_info'),
    settingsGet: () => call('settings_get'),
    settingsSave: (settings) => call('settings_save', { settings }),
    repoResolve: (path) => call('repo_resolve', { path }),
    status: (root) => call('status_get', { root }),
    refs: (root) => call('refs_get', { root }),
    log: (root, query) => call('log_get', { root, query }),
    commit: (root, sha) => call('commit_get', { root, sha }),
    commitBranches: (root, sha) => call('commit_branches', { root, sha }),
    diff: (root, target, options) => call('diff_get', { root, target, options: options ?? null }),
    outgoing: (root, all) => call('outgoing_get', { root, all }),
    activity: (root, limit) => call('activity_get', { root, limit: limit ?? null }),
    fileHistory: (root, path, follow, skip, limit, rev) => call('file_history', { root, path, follow, skip, limit, rev: rev ?? null }),
    blame: (root, path, rev) => call('file_blame', { root, path, rev: rev ?? null }),
    fileContent: (root, path, rev) => call('file_content', { root, path, rev: rev ?? null }),
    lineHistory: (root, path, start, end, rev) => call('line_history', { root, path, start, end, rev: rev ?? null }),
    files: (root, rev) => call('files_list', { root, rev: rev ?? null }),
    fetch: (root) => call('fetch', { root }),
    watch: (roots) => call('watch_set', { roots }),
    onChanged: (cb) => listen<RepoChange>('repo://changed', (e) => cb(e.payload)),
    openPath: (path) => call('open_path', { path }),
    revealPath: (path) => call('reveal_path', { path }),
    openTerminal: (root) => call('open_terminal', { root }),
    openEditor: (path) => call('open_editor', { path }),
    notify: (title, body) => call('notify_send', { title, body }),
    async pickFolder() {
      const r = await dialog.open({ directory: true, multiple: false, title: '저장소 폴더 선택' })
      return typeof r === 'string' ? r : null
    },
  }
}

export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function createBackend(): Promise<Backend> {
  if (inTauri()) return createTauriBackend()
  const { createMockBackend } = await import('./mock')
  return createMockBackend()
}
