// 백엔드(src-tauri/src/git/model.rs)와 같은 모양의 데이터

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

export interface RefLabel {
  kind: RefKind
  name: string
}

export interface Commit {
  sha: string
  parents: string[]
  author: string
  email: string
  /** 유닉스 초 */
  time: number
  subject: string
  refs: RefLabel[]
}

/** 히스토리의 작성자 (작성자로 거르기) */
export interface Author {
  name: string
  /** 가장 많이 쓴 메일 */
  email: string
  count: number
}

export interface FileChange {
  /** A, M, D, R, C, T, U */
  status: string
  path: string
  oldPath: string | null
  additions: number | null
  deletions: number | null
  binary: boolean
}

export interface CommitDetail {
  sha: string
  parents: string[]
  author: string
  email: string
  time: number
  committer: string
  committerEmail: string
  commitTime: number
  message: string
  files: FileChange[]
}

export interface WorkFile {
  path: string
  oldPath: string | null
  /** A, M, D, R, C, T, U(충돌), ?(추적 안 함) */
  status: string
  /** 유닉스 밀리초 */
  mtime: number | null
}

export interface Status {
  root: string
  branch: string | null
  head: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  state: string | null
  staged: WorkFile[]
  unstaged: WorkFile[]
  conflicted: WorkFile[]
  truncated: boolean
}

export interface Branch {
  name: string
  sha: string
  upstream: string | null
  ahead: number | null
  behind: number | null
  gone: boolean
  time: number
  subject: string
  current: boolean
}

export interface RemoteBranch {
  name: string
  sha: string
  time: number
}

export interface Remote {
  name: string
  url: string | null
  branches: RemoteBranch[]
}

export interface Tag {
  name: string
  sha: string
  time: number
}

export interface Stash {
  index: number
  sha: string
  time: number
  message: string
}

export interface Refs {
  branches: Branch[]
  remotes: Remote[]
  tags: Tag[]
  stashes: Stash[]
}

export type LogScope = { kind: 'all' } | { kind: 'current' } | { kind: 'revs'; revs: string[] }

export interface LogQuery {
  scope: LogScope
  skip: number
  limit: number
  message?: string | null
  author?: string | null
  path?: string | null
}

export type DiffTarget =
  | { kind: 'worktree'; path: string; untracked: boolean }
  | { kind: 'staged'; path: string; oldPath: string | null }
  | { kind: 'commit'; sha: string; path: string; oldPath: string | null }
  | { kind: 'range'; from: string | null; to: string; path: string; oldPath: string | null }
  | { kind: 'blobs'; aRev: string; aPath: string; bRev: string; bPath: string }
  | { kind: 'revToWorktree'; rev: string; revPath: string; path: string }

export interface DiffOptions {
  ignoreWhitespace?: boolean
  context?: number | null
}

export interface TextBlob {
  text: string
  binary: boolean
  truncated: boolean
  encoding: string
  size: number
}

export interface OutgoingBranch {
  branch: string
  current: boolean
  remote: string | null
  target: string | null
  newBranch: boolean
  base: string | null
  commits: Commit[]
  files: FileChange[]
  behind: number
  truncated: boolean
}

export interface ActivityEntry {
  time: number
  refName: string
  old: string
  new: string
  message: string
  who: string
  subject: string | null
  oldSubject: string | null
  dropped: number
}

export interface HistoryEntry {
  commit: Commit
  path: string
  oldPath: string | null
  status: string
  additions: number | null
  deletions: number | null
}

export interface BlameCommit {
  sha: string
  author: string
  email: string
  time: number
  summary: string
  path: string
}

export interface BlameLine {
  c: number
  origLine: number
  text: string
}

export interface Blame {
  commits: BlameCommit[]
  lines: BlameLine[]
  encoding: string
}

export interface LineHistoryEntry {
  commit: Commit
  diff: string
}

export interface RepoEntry {
  path: string
  name: string
}

export interface Settings {
  repos: RepoEntry[]
  tabs: string[]
  active: string | null
  theme: 'system' | 'dark' | 'light'
  fetchMinutes: number
  historyScope: 'all' | 'current'
  diffMode: 'unified' | 'split'
  ignoreWhitespace: boolean
  editor: string
  terminal: string
  sidebarWidth: number
  /** Windows 알림 */
  notifyEnabled: boolean
  notifyCommit: boolean
  notifyPush: boolean
  /** 전환·병합·pull·브랜치 생성 */
  notifyBranch: boolean
  /** reset·강제 push·amend·rebase 같은 주의가 필요한 작업 */
  notifyWarn: boolean
  /** 앱을 보고 있을 때도 알림 (끄면 앱 안의 알림만) */
  notifyWhenFocused: boolean
  /** 창을 닫으면 트레이로 숨기고 감시를 계속 */
  closeToTray: boolean
  /** Windows 시작 시 트레이로 실행 */
  startWithWindows: boolean
  /** 감시 전용: 저장소를 바꾸는 조작 버튼을 숨기고 막는다 */
  readOnly: boolean
  pullMode: PullMode
  /** 커밋한 뒤 바로 push */
  commitPush: boolean
}

export type HunkAction = 'stage' | 'unstage' | 'discard'
export type PullMode = 'merge' | 'rebase' | 'ff-only'

/** 저장소를 바꾸는 조작 (src-tauri/src/git/ops.rs의 Op) */
export type GitOp =
  | { kind: 'stage'; paths: string[] }
  | { kind: 'unstage'; paths: string[] }
  /** staged면 스테이지된 변경까지 HEAD로, 아니면 작업 트리만 */
  | { kind: 'discard'; paths: string[]; staged: boolean }
  | { kind: 'hunk'; path: string; header: string; action: HunkAction }
  | { kind: 'commit'; message: string; amend: boolean }
  | { kind: 'push'; branch: string | null; remote: string | null; force: boolean }
  | { kind: 'pull'; mode: PullMode }
  | { kind: 'branchCreate'; name: string; start: string | null; checkout: boolean }
  | { kind: 'switch'; branch: string }
  | { kind: 'switchRemote'; remoteBranch: string }
  | { kind: 'detach'; rev: string }
  | { kind: 'branchDelete'; name: string; force: boolean }
  | { kind: 'branchRename'; old: string; new: string }
  | { kind: 'merge'; rev: string; noFf: boolean }
  | { kind: 'stashPush'; message: string | null; untracked: boolean }
  | { kind: 'stashApply'; index: number; pop: boolean }
  | { kind: 'stashDrop'; index: number }
  | { kind: 'tagCreate'; name: string; rev: string | null; message: string | null }
  | { kind: 'tagDelete'; name: string }
  | { kind: 'pushTag'; remote: string; name: string }
  | { kind: 'cherryPick'; rev: string }
  | { kind: 'revert'; rev: string }
  | { kind: 'abort' }
  | { kind: 'continue' }
  | { kind: 'restoreFile'; path: string; rev: string }
  | { kind: 'ignore'; pattern: string }

/** 트레이 메뉴에서 고른 동작 */
export type TrayAction = { kind: 'openRepo'; root: string } | { kind: 'toggleNotify' } | { kind: 'fetchAll' }

export interface AppInfo {
  version: string
  gitPath: string | null
  gitVersion: string | null
  gitError: string | null
  dataDir: string
}

export interface RepoChange {
  root: string
  worktree: boolean
  git: boolean
}
