// 파일·커밋 우클릭 메뉴 (어느 화면에서든 같은 메뉴)

import type { MenuEntry } from './components/ContextMenu.svelte'
import { joinPath, short } from './format'
import { app, type Repo } from './state.svelte'

export interface FileRef {
  path: string
  /** 이 파일을 보고 있는 커밋 (작업 트리면 없음) */
  rev?: string | null
  /** 지워진 파일 (작업 트리에 없음) */
  deleted?: boolean
}

export function fileMenu(repo: Repo, f: FileRef): MenuEntry[] {
  const abs = joinPath(repo.root, f.path)
  const items: MenuEntry[] = [
    { label: '이력 조회', icon: 'history', shortcut: 'Ctrl+H', action: () => repo.openFileHistory({ path: f.path, rev: f.rev ?? null, tab: 'diff' }) },
    { label: 'Blame (줄마다 마지막 변경)', icon: 'blame', action: () => repo.openFileHistory({ path: f.path, rev: f.rev ?? null, tab: 'blame' }) },
  ]
  if (f.rev) {
    items.push(
      { label: `이 버전 내용 보기 (${short(f.rev)})`, icon: 'eye', action: () => repo.openFileHistory({ path: f.path, rev: f.rev, tab: 'content' }) },
      { label: '작업 트리와 비교', icon: 'compare', disabled: f.deleted, action: () => repo.openFileHistory({ path: f.path, rev: f.rev, tab: 'worktree' }) },
    )
  }
  items.push(
    'separator',
    { label: '파일 열기', icon: 'file', disabled: f.deleted, action: () => app.run(() => app.backend.openPath(abs)) },
    { label: '편집기로 열기', icon: 'editor', disabled: f.deleted, action: () => app.run(() => app.backend.openEditor(abs)) },
    { label: '탐색기에서 보기', icon: 'folder', disabled: f.deleted, action: () => app.run(() => app.backend.revealPath(abs)) },
    'separator',
    { label: '경로 복사', icon: 'copy', action: () => app.copy(abs, '경로') },
    { label: '상대 경로 복사', action: () => app.copy(f.path, '경로') },
  )
  return items
}

export function commitMenu(repo: Repo, sha: string, subject: string): MenuEntry[] {
  return [
    { label: '히스토리에서 보기', icon: 'history', action: () => repo.reveal(sha) },
    'separator',
    { label: '커밋 해시 복사', icon: 'copy', action: () => app.copy(sha, '해시') },
    { label: '짧은 해시 복사', action: () => app.copy(short(sha), '해시') },
    { label: '메시지 복사', action: () => app.copy(subject, '메시지') },
  ]
}
