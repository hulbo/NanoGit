// 파일·커밋 우클릭 메뉴 (어느 화면에서든 같은 메뉴)

import * as act from './actions'
import type { MenuEntry } from './components/ContextMenu.svelte'
import { basename, joinPath, short } from './format'
import { app, type Repo } from './state.svelte'
import type { WorkFile } from './types'

export interface FileRef {
  path: string
  /** 이 파일을 보고 있는 커밋 (작업 트리면 없음) */
  rev?: string | null
  /** 지워진 파일 (작업 트리에 없음) */
  deleted?: boolean
  /** 파일 상태 화면의 파일: 어느 목록에 있는지 */
  work?: { group: 'staged' | 'unstaged' | 'conflicted'; file: WorkFile }
}

/** 파일 상태의 파일에 대한 조작 (스테이지·버리기·무시) */
function workItems(repo: Repo, w: NonNullable<FileRef['work']>): MenuEntry[] {
  const f = w.file
  const items: MenuEntry[] = []
  if (w.group === 'staged') items.push({ label: '언스테이지', icon: 'minus', action: () => act.unstage(repo, [f]) })
  else items.push({ label: w.group === 'conflicted' ? '해결됨으로 표시 (스테이지)' : '스테이지', icon: 'plus', action: () => act.stage(repo, [f]) })
  items.push({
    label: w.group === 'unstaged' ? (f.status === '?' ? '파일 지우기 (휴지통)' : '변경 버리기') : '마지막 커밋으로 되돌리기',
    icon: 'trash',
    danger: true,
    action: () => act.discard(repo, [f], w.group !== 'unstaged'),
  })
  if (f.status === '?') items.push({ label: '.gitignore에 추가…', icon: 'eye', action: () => act.ignore(repo, f.path) })
  return items
}

export function fileMenu(repo: Repo, f: FileRef): MenuEntry[] {
  const abs = joinPath(repo.root, f.path)
  const items: MenuEntry[] = [
    { label: '이력 조회', icon: 'history', action: () => repo.openFileHistory({ path: f.path, rev: f.rev ?? null, tab: 'diff' }) },
    { label: 'Blame (줄마다 마지막 변경)', icon: 'blame', action: () => repo.openFileHistory({ path: f.path, rev: f.rev ?? null, tab: 'blame' }) },
  ]
  if (f.rev) {
    items.push(
      { label: `이 버전 내용 보기 (${short(f.rev)})`, icon: 'eye', action: () => repo.openFileHistory({ path: f.path, rev: f.rev, tab: 'content' }) },
      { label: '작업 트리와 비교', icon: 'compare', disabled: f.deleted, action: () => repo.openFileHistory({ path: f.path, rev: f.rev, tab: 'worktree' }) },
    )
  }
  if (app.canWrite && f.work) items.push('separator', ...workItems(repo, f.work))
  if (app.canWrite && f.rev && !f.work) items.push({ label: `이 버전으로 되돌리기 (${short(f.rev)})…`, icon: 'undo', disabled: f.deleted, action: () => act.restoreFile(repo, f.path, f.rev!) })
  items.push(
    'separator',
    { label: '파일 열기', icon: 'file', disabled: f.deleted, action: () => app.run(() => app.backend.openPath(abs)) },
    { label: '편집기로 열기', icon: 'editor', disabled: f.deleted, action: () => app.run(() => app.backend.openEditor(abs)) },
    { label: '탐색기에서 보기', icon: 'folder', disabled: f.deleted, action: () => app.run(() => app.backend.revealPath(abs)) },
    'separator',
    { label: '경로 복사', icon: 'copy', action: () => app.copy(abs, '경로') },
    { label: '상대 경로 복사', action: () => app.copy(f.path, '경로') },
    { label: '파일 이름 복사', action: () => app.copy(basename(f.path), '파일 이름') },
  )
  return items
}

export function commitMenu(repo: Repo, sha: string, subject: string): MenuEntry[] {
  const items: MenuEntry[] = [{ label: '히스토리에서 보기', icon: 'history', action: () => repo.reveal(sha) }]
  if (app.canWrite) {
    const at = { rev: sha, label: `${short(sha)} ${subject}` }
    items.push(
      'separator',
      { label: '여기서 새 브랜치…', icon: 'branch', action: () => act.createBranch(repo, at) },
      { label: '태그 만들기…', icon: 'tag', action: () => act.createTag(repo, at) },
      { label: '이 커밋으로 전환 (분리된 HEAD)…', icon: 'commit', action: () => act.detach(repo, sha, at.label) },
      { label: 'cherry-pick (지금 브랜치로 가져오기)…', action: () => act.cherryPick(repo, sha, subject) },
      { label: '되돌리는 커밋 만들기 (revert)…', icon: 'undo', action: () => act.revert(repo, sha, subject) },
    )
  }
  items.push(
    'separator',
    { label: '커밋 해시 복사', icon: 'copy', action: () => app.copy(sha, '해시') },
    { label: '짧은 해시 복사', action: () => app.copy(short(sha), '해시') },
    { label: '메시지 복사', action: () => app.copy(subject, '메시지') },
  )
  return items
}

/** 사이드바 로컬 브랜치 */
export function branchMenu(repo: Repo, b: { name: string; sha: string; subject: string; current: boolean; upstream: string | null }): MenuEntry[] {
  const items: MenuEntry[] = []
  if (app.canWrite) {
    if (!b.current) items.push({ label: `${b.name}(으)로 전환`, icon: 'branch', shortcut: '더블클릭', action: () => act.switchBranch(repo, b.name) })
    if (!b.current && repo.status?.branch) items.push({ label: `${repo.status.branch}에 병합…`, icon: 'merge', action: () => act.merge(repo, b.name) })
    items.push(
      { label: 'Push…', icon: 'push', action: () => act.push(repo, b.name) },
      { label: '여기서 새 브랜치…', icon: 'plus', action: () => act.createBranch(repo, { rev: b.name, label: b.name }) },
      { label: '이름 바꾸기…', action: () => act.renameBranch(repo, b.name) },
      { label: '삭제…', icon: 'trash', danger: true, disabled: b.current, action: () => act.deleteBranch(repo, b.name) },
      'separator',
    )
  }
  return items
}

/** 사이드바 원격 브랜치 */
export function remoteBranchMenu(repo: Repo, name: string): MenuEntry[] {
  if (!app.canWrite) return []
  const local = act.localNameOf(name, repo.refs?.remotes.map((r) => r.name) ?? [])
  return [
    { label: `${local}(으)로 체크아웃 (추적)`, icon: 'branch', shortcut: '더블클릭', action: () => act.switchRemote(repo, name) },
    ...(repo.status?.branch ? [{ label: `${repo.status.branch}에 병합…`, icon: 'merge' as const, action: () => act.merge(repo, name) }] : []),
    { label: '여기서 새 브랜치…', icon: 'plus', action: () => act.createBranch(repo, { rev: name, label: name }) },
    'separator',
  ]
}

/** 사이드바 태그 */
export function tagMenu(repo: Repo, name: string): MenuEntry[] {
  if (!app.canWrite) return []
  return [
    { label: '원격에 push', icon: 'push', action: () => act.pushTag(repo, name) },
    { label: '여기서 새 브랜치…', icon: 'plus', action: () => act.createBranch(repo, { rev: name, label: name }) },
    { label: '이 태그로 전환 (분리된 HEAD)…', icon: 'commit', action: () => act.detach(repo, name, name) },
    { label: '삭제…', icon: 'trash', danger: true, action: () => act.deleteTag(repo, name) },
    'separator',
  ]
}

/** 사이드바 stash */
export function stashMenu(repo: Repo, index: number, message: string): MenuEntry[] {
  if (!app.canWrite) return []
  return [
    { label: '적용 (목록에 남김)', icon: 'stash', action: () => act.stashApply(repo, index, false) },
    { label: '꺼내기 (적용 후 지움)', action: () => act.stashApply(repo, index, true) },
    { label: '삭제…', icon: 'trash', danger: true, action: () => act.stashDrop(repo, index, message) },
    'separator',
  ]
}
