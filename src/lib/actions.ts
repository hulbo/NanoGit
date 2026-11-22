// 직접 조작 흐름 (M3): 확인·입력 대화상자 → 조작 → 알림.
// 실제 git 실행은 백엔드(src-tauri/src/git/ops.rs), 여기서는 무엇을 물어보고 무엇을 보낼지만 정한다.

import { short } from './format'
import { app, type Repo } from './state.svelte'
import type { OutgoingBranch, PullMode, WorkFile } from './types'

/** 원격 브랜치 이름(`origin/feature/x`)에서 로컬 브랜치 이름 */
export function localNameOf(remoteBranch: string, remotes: string[]): string {
  const r = remotes.find((x) => remoteBranch.startsWith(`${x}/`))
  return r ? remoteBranch.slice(r.length + 1) : remoteBranch
}

/** 무시 규칙 후보: 이 파일, 같은 확장자, 같은 폴더 */
export function ignorePatterns(path: string): { pattern: string; label: string }[] {
  const out = [{ pattern: `/${path}`, label: `이 파일만 (/${path})` }]
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot > 0) out.push({ pattern: `*${base.slice(dot)}`, label: `확장자가 ${base.slice(dot)}인 모든 파일 (*${base.slice(dot)})` })
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  if (dir) out.push({ pattern: `/${dir}/`, label: `폴더 전체 (/${dir}/)` })
  return out
}

/** 파일 목록에서 조작에 넘길 경로 (이름이 바뀐 파일은 이전 경로도) */
export function pathsOf(files: Pick<WorkFile, 'path' | 'oldPath'>[]): string[] {
  const set = new Set<string>()
  for (const f of files) {
    set.add(f.path)
    if (f.oldPath && f.oldPath !== f.path) set.add(f.oldPath)
  }
  return [...set]
}

const commitTitle = (out: string) => out.match(/^\[[^\]]+\]\s*(.*)$/m)?.[1] ?? ''

export async function stage(repo: Repo, files: WorkFile[]) {
  if (!files.length) return
  await repo.run({ kind: 'stage', paths: pathsOf(files) }, '스테이지')
}

export async function unstage(repo: Repo, files: WorkFile[]) {
  if (!files.length) return
  await repo.run({ kind: 'unstage', paths: pathsOf(files) }, '언스테이지')
}

/** 변경 버리기. staged면 스테이지된 변경까지 마지막 커밋으로 되돌린다 */
export async function discard(repo: Repo, files: WorkFile[], staged: boolean) {
  if (!files.length) return
  const untracked = files.filter((f) => f.status === '?').length
  const text = staged
    ? '고른 파일을 마지막 커밋 상태로 되돌립니다. 스테이지된 변경과 작업 트리 변경이 모두 사라집니다.'
    : '고른 파일의 스테이지 안 된 변경을 버립니다. 스테이지된 변경은 그대로 둡니다.'
  const ok = await app.confirm('변경 버리기', `${text}${untracked ? `\n추적하지 않는 새 파일 ${untracked}개는 지워집니다.` : ''}\n지금 파일은 휴지통에 남으므로 필요하면 되살릴 수 있습니다.`, {
    ok: '버리기',
    danger: true,
    items: files.map((f) => `${f.status} ${f.path}`),
  })
  if (!ok) return
  await repo.run({ kind: 'discard', paths: pathsOf(files), staged }, '변경 버리기', `파일 ${files.length}개의 변경을 버렸습니다 (휴지통에 남김)`)
}

export async function ignore(repo: Repo, path: string) {
  const options = ignorePatterns(path)
  const v = await app.ask({
    title: '.gitignore에 추가',
    icon: 'eye',
    fields: [
      { kind: 'select', key: 'pattern', label: '무시할 대상', value: options[0].pattern, options: options.map((o) => ({ value: o.pattern, label: o.label })) },
      { kind: 'info', tone: 'muted', text: '저장소 맨 위의 .gitignore 끝에 한 줄을 덧붙입니다. 이미 추적 중인 파일에는 효과가 없습니다.' },
    ],
    ok: '추가',
  })
  if (!v) return
  await repo.run({ kind: 'ignore', pattern: String(v.pattern) }, '.gitignore에 추가', (out) => out || null)
}

/** 파일을 그 버전 내용으로 (작업 트리만) */
export async function restoreFile(repo: Repo, path: string, rev: string) {
  const ok = await app.confirm('이 버전으로 되돌리기', `${path}을(를) ${short(rev)} 버전 내용으로 바꿉니다. 스테이지는 그대로이고, 바뀐 내용은 파일 상태에 변경으로 보입니다.\n지금 파일은 휴지통에 남습니다.`, {
    ok: '되돌리기',
  })
  if (!ok) return
  await repo.run({ kind: 'restoreFile', path, rev }, '이 버전으로 되돌리기', `${path}을(를) ${short(rev)} 버전으로 되돌렸습니다`)
}

/** 커밋 (입력란의 메시지). 설정에 따라 바로 push */
export async function commit(repo: Repo): Promise<boolean> {
  const message = repo.draft.trim()
  if (!message) {
    app.toast('커밋 메시지를 쓰세요', 'warn')
    return false
  }
  const staged = repo.status?.staged.length ?? 0
  if (!staged && !repo.amend) {
    app.toast('스테이지된 파일이 없습니다. 커밋할 파일을 먼저 스테이지하세요', 'warn')
    return false
  }
  if (repo.status?.conflicted.length) {
    app.toast('충돌이 남아 있습니다. 해결한 뒤 스테이지하세요', 'warn')
    return false
  }
  const amend = repo.amend
  const out = await repo.run({ kind: 'commit', message, amend }, amend ? '커밋 고치기(amend)' : '커밋', (o) => `${amend ? '마지막 커밋을 고쳤습니다' : '커밋했습니다'}: ${commitTitle(o) || message.split('\n')[0]}`)
  if (out === null) return false
  repo.draft = ''
  repo.amend = false
  if (app.settings.commitPush) await repo.run({ kind: 'push', branch: null, remote: null, force: false }, 'push', 'push했습니다')
  return true
}

/** 커밋 고치기(amend)를 켜면 마지막 커밋 메시지를 불러온다. 불러온 메시지를 돌려준다 */
export async function loadAmendMessage(repo: Repo): Promise<string | null> {
  if (repo.draft.trim()) return null
  try {
    repo.draft = (await app.backend.commit(repo.root, 'HEAD')).message
    return repo.draft
  } catch {
    // 첫 커밋 전이면 불러올 메시지가 없다
    return null
  }
}

/** push 확인 (IntelliJ push 대화상자처럼 올라갈 커밋을 보여 준다) */
export async function push(repo: Repo, target?: OutgoingBranch | string | null) {
  let b: OutgoingBranch | null = typeof target === 'object' ? (target ?? null) : null
  if (!b) {
    // 브랜치 이름만 받았거나 없으면 push 대기를 다시 계산해 그 브랜치를 찾는다
    const name = typeof target === 'string' ? target : repo.status?.branch
    if (!repo.outgoing) await repo.refreshOutgoing()
    b = repo.outgoing?.find((o) => o.branch === name) ?? null
    if (!b && name) b = (await app.backend.outgoing(repo.root, true).catch(() => [])).find((o) => o.branch === name) ?? null
  }
  const branchName = b?.branch ?? (typeof target === 'string' ? target : repo.status?.branch) ?? null
  if (!branchName) {
    app.toast('분리된 HEAD라 push할 브랜치가 없습니다', 'warn')
    return
  }
  const remotes = repo.refs?.remotes.map((r) => r.name) ?? []
  if (!remotes.length) {
    app.toast('원격 저장소가 없습니다. 먼저 git remote add로 원격을 추가하세요', 'warn')
    return
  }
  const commits = b?.commits ?? []
  const fields: Parameters<typeof app.ask>[0]['fields'] = [
    { kind: 'info', text: b?.target ? `${branchName} → ${b.target}${b.newBranch ? ' (원격에 새로 만듦, 추적 설정)' : ''}` : `${branchName}을(를) 원격에 올립니다` },
  ]
  if (commits.length) fields.push({ kind: 'list', label: `올라갈 커밋 ${commits.length}${b?.truncated ? '+' : ''}개`, items: commits.map((c) => `${short(c.sha)}  ${c.subject}`) })
  else if (!b?.newBranch) fields.push({ kind: 'info', tone: 'muted', text: 'push할 커밋이 없습니다. 원격과 같거나, 커밋을 고쳐(amend·rebase) 강제 push가 필요한 경우입니다.' })
  if (b && b.behind > 0) fields.push({ kind: 'info', tone: 'warn', text: `원격에 내가 없는 커밋이 ${b.behind}개 있어 push가 거부될 수 있습니다. 먼저 pull하거나, 내 이력으로 덮어써야 하면 강제 push를 고르세요.` })
  if (remotes.length > 1 && !b?.remote) fields.push({ kind: 'select', key: 'remote', label: '원격', value: remotes.includes('origin') ? 'origin' : remotes[0], options: remotes.map((r) => ({ value: r, label: r })) })
  fields.push({ kind: 'check', key: 'force', label: '강제 push (--force-with-lease)', hint: '원격이 마지막으로 본 상태 그대로일 때만 덮어씁니다. 다른 사람의 커밋을 지우지 않게 막아 줍니다', danger: true })
  const v = await app.ask({ title: 'Push', icon: 'push', fields, ok: 'Push' })
  if (!v) return
  const force = v.force === true
  if (force && !(await app.confirm('강제 push', `원격의 ${b?.target ?? branchName}을(를) 내 이력으로 덮어씁니다. 원격에만 있던 커밋은 사라집니다.`, { ok: '강제 push', danger: true }))) return
  await repo.run(
    { kind: 'push', branch: branchName, remote: typeof v.remote === 'string' ? v.remote : (b?.remote ?? null), force },
    force ? '강제 push' : 'push',
    `${branchName}을(를) push했습니다${commits.length ? ` (커밋 ${commits.length}개)` : ''}`,
  )
}

const PULL_MODES: { value: PullMode; label: string }[] = [
  { value: 'merge', label: '병합 (git pull --no-rebase)' },
  { value: 'rebase', label: 'rebase (git pull --rebase)' },
  { value: 'ff-only', label: 'fast-forward만 (갈라졌으면 멈춤)' },
]

export async function pull(repo: Repo) {
  const s = repo.status
  if (!s?.branch) {
    app.toast('분리된 HEAD에서는 pull할 수 없습니다', 'warn')
    return
  }
  const v = await app.ask({
    title: 'Pull',
    icon: 'pull',
    fields: [
      s.upstream
        ? { kind: 'info', text: `${s.upstream}에서 가져와 ${s.branch}에 합칩니다${s.behind ? ` (가져올 커밋 ${s.behind}개, 마지막 fetch 기준)` : ''}` }
        : { kind: 'info', tone: 'warn', text: `${s.branch}에 추적 브랜치가 없어 pull할 곳이 없습니다. 먼저 push로 추적을 거세요.` },
      { kind: 'select', key: 'mode', label: '합치는 방식', value: app.settings.pullMode, options: PULL_MODES },
      ...(repo.changeCount ? [{ kind: 'info' as const, tone: 'muted' as const, text: `커밋하지 않은 변경 ${repo.changeCount}개가 있습니다. 겹치는 파일이 있으면 git이 pull을 멈춥니다.` }] : []),
    ],
    ok: 'Pull',
  })
  if (!v) return
  const mode = v.mode as PullMode
  if (mode !== app.settings.pullMode) {
    app.settings.pullMode = mode
    void app.persist()
  }
  await repo.run({ kind: 'pull', mode }, 'pull', (out) => (/Already up to date|이미 업데이트/.test(out) ? '이미 최신입니다' : 'pull했습니다'))
}

export async function createBranch(repo: Repo, start?: { rev: string; label: string } | null) {
  const v = await app.ask({
    title: '새 브랜치',
    icon: 'branch',
    fields: [
      { kind: 'text', key: 'name', label: '브랜치 이름', placeholder: 'feature/login', required: true, mono: true },
      { kind: 'info', tone: 'muted', text: `시작 위치: ${start ? start.label : `지금 위치 (${repo.status?.branch ?? short(repo.status?.head ?? '')})`}` },
      { kind: 'check', key: 'checkout', label: '만든 뒤 그 브랜치로 전환', value: true },
    ],
    ok: '만들기',
    validate: (x) => (/\s/.test(String(x.name).trim()) ? '브랜치 이름에 공백을 쓸 수 없습니다' : null),
  })
  if (!v) return
  const name = String(v.name).trim()
  await repo.run({ kind: 'branchCreate', name, start: start?.rev ?? null, checkout: v.checkout === true }, '브랜치 만들기', `브랜치 ${name}을(를) 만들었습니다${v.checkout ? ' (전환함)' : ''}`)
}

export async function switchBranch(repo: Repo, name: string) {
  if (repo.status?.branch === name) return
  await repo.run({ kind: 'switch', branch: name }, '브랜치 전환', `${name}(으)로 전환했습니다`)
}

export async function switchRemote(repo: Repo, remoteBranch: string) {
  const local = localNameOf(remoteBranch, repo.refs?.remotes.map((r) => r.name) ?? [])
  await repo.run({ kind: 'switchRemote', remoteBranch }, '브랜치 전환', `${remoteBranch}을(를) 추적하는 ${local}(으)로 전환했습니다`)
}

export async function detach(repo: Repo, rev: string, label: string) {
  const ok = await app.confirm('커밋으로 전환', `${label}(으)로 전환합니다. 브랜치가 아닌 커밋에 있게 되므로(분리된 HEAD), 여기서 커밋하려면 먼저 브랜치를 만드세요.`, { ok: '전환' })
  if (ok) await repo.run({ kind: 'detach', rev }, '커밋으로 전환', `${label}(으)로 전환했습니다 (분리된 HEAD)`)
}

export async function deleteBranch(repo: Repo, name: string) {
  if (!(await app.confirm('브랜치 삭제', `로컬 브랜치 ${name}을(를) 지웁니다. 원격 브랜치는 그대로입니다.`, { ok: '삭제', danger: true }))) return
  const out = await repo.run({ kind: 'branchDelete', name, force: false }, '브랜치 삭제', `브랜치 ${name}을(를) 지웠습니다`)
  if (out !== null) return
  // 병합되지 않은 커밋이 있으면 git이 막는다: 한 번 더 묻고 강제로
  const again = await app.confirm('병합되지 않은 브랜치', `${name}에는 다른 브랜치에 없는 커밋이 있습니다. 그래도 지우면 그 커밋은 브랜치에서 사라집니다 (활동 기록으로 찾을 수는 있음).`, {
    ok: '강제 삭제',
    danger: true,
  })
  if (again) await repo.run({ kind: 'branchDelete', name, force: true }, '브랜치 강제 삭제', `브랜치 ${name}을(를) 지웠습니다`)
}

export async function renameBranch(repo: Repo, name: string) {
  const v = await app.ask({
    title: '브랜치 이름 바꾸기',
    icon: 'branch',
    fields: [{ kind: 'text', key: 'name', label: '새 이름', value: name, required: true, mono: true }],
    ok: '바꾸기',
  })
  const next = v ? String(v.name).trim() : ''
  if (!next || next === name) return
  await repo.run({ kind: 'branchRename', old: name, new: next }, '브랜치 이름 바꾸기', `${name} → ${next}`)
}

export async function merge(repo: Repo, rev?: string) {
  const cur = repo.status?.branch
  if (!cur) {
    app.toast('분리된 HEAD에서는 병합할 수 없습니다. 먼저 브랜치로 전환하세요', 'warn')
    return
  }
  const options = [
    ...(repo.refs?.branches.filter((b) => !b.current).map((b) => ({ value: b.name, label: b.name })) ?? []),
    ...(repo.refs?.remotes.flatMap((r) => r.branches.map((b) => ({ value: b.name, label: `${b.name} (원격)` }))) ?? []),
  ]
  if (rev && !options.some((o) => o.value === rev)) options.unshift({ value: rev, label: rev.length === 40 ? short(rev) : rev })
  if (!options.length) {
    app.toast('병합할 다른 브랜치가 없습니다', 'warn')
    return
  }
  const v = await app.ask({
    title: `${cur}에 병합`,
    icon: 'merge',
    fields: [
      { kind: 'select', key: 'rev', label: '가져올 브랜치', value: rev ?? options[0].value, options },
      { kind: 'check', key: 'noFf', label: '항상 병합 커밋 만들기 (--no-ff)', hint: '끄면 앞으로 감기(fast-forward)가 가능할 때 커밋을 만들지 않습니다' },
      ...(repo.changeCount ? [{ kind: 'info' as const, tone: 'muted' as const, text: `커밋하지 않은 변경 ${repo.changeCount}개가 있습니다. 겹치는 파일이 있으면 git이 병합을 멈춥니다.` }] : []),
    ],
    ok: '병합',
  })
  if (!v) return
  const r = String(v.rev)
  const out = await repo.run({ kind: 'merge', rev: r, noFf: v.noFf === true }, '병합', (o) => (/Already up to date|이미 업데이트/.test(o) ? '이미 병합되어 있습니다' : `${r}을(를) ${cur}에 병합했습니다`))
  if (out === null && repo.status?.state === 'merging') {
    repo.setView('status')
    app.toast('충돌이 났습니다. 파일 상태에서 충돌 파일을 고치고 스테이지한 뒤 "계속"을 누르세요. 그만두려면 "중단"', 'warn')
  }
}

export async function stash(repo: Repo) {
  if (!repo.changeCount) {
    app.toast('stash할 변경이 없습니다', 'info')
    return
  }
  const v = await app.ask({
    title: 'Stash (변경 잠시 보관)',
    icon: 'stash',
    fields: [
      { kind: 'text', key: 'message', label: '메시지 (선택)', placeholder: '무엇을 하던 중인지' },
      { kind: 'check', key: 'untracked', label: '새 파일(추적 안 함)도 함께 보관', value: true },
      { kind: 'info', tone: 'muted', text: `변경 ${repo.changeCount}개를 보관하고 작업 트리를 마지막 커밋 상태로 되돌립니다. 사이드바 Stash에서 다시 꺼낼 수 있습니다.` },
    ],
    ok: '보관',
  })
  if (!v) return
  await repo.run({ kind: 'stashPush', message: String(v.message).trim() || null, untracked: v.untracked === true }, 'stash', '변경을 stash에 보관했습니다')
}

export async function stashApply(repo: Repo, index: number, pop: boolean) {
  await repo.run({ kind: 'stashApply', index, pop }, pop ? 'stash 꺼내기' : 'stash 적용', pop ? 'stash를 꺼냈습니다 (목록에서 지움)' : 'stash를 적용했습니다 (목록에 남김)')
}

export async function stashDrop(repo: Repo, index: number, message: string) {
  if (await app.confirm('stash 삭제', `보관한 변경을 지웁니다: ${message}`, { ok: '삭제', danger: true }))
    await repo.run({ kind: 'stashDrop', index }, 'stash 삭제', 'stash를 지웠습니다')
}

export async function createTag(repo: Repo, rev?: { rev: string; label: string } | null) {
  const remotes = repo.refs?.remotes.map((r) => r.name) ?? []
  const v = await app.ask({
    title: '태그 만들기',
    icon: 'tag',
    fields: [
      { kind: 'text', key: 'name', label: '태그 이름', placeholder: 'v1.0.0', required: true, mono: true },
      { kind: 'info', tone: 'muted', text: `커밋: ${rev ? rev.label : `지금 위치 (${short(repo.status?.head ?? '')})`}` },
      { kind: 'text', key: 'message', label: '메시지 (쓰면 주석 태그)', placeholder: '선택' },
      ...(remotes.length ? [{ kind: 'check' as const, key: 'push', label: `만든 뒤 ${remotes.includes('origin') ? 'origin' : remotes[0]}에 push` }] : []),
    ],
    ok: '만들기',
  })
  if (!v) return
  const name = String(v.name).trim()
  const out = await repo.run({ kind: 'tagCreate', name, rev: rev?.rev ?? null, message: String(v.message).trim() || null }, '태그 만들기', `태그 ${name}을(를) 만들었습니다`)
  if (out !== null && v.push === true) await pushTag(repo, name)
}

export async function pushTag(repo: Repo, name: string) {
  const remotes = repo.refs?.remotes.map((r) => r.name) ?? []
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote) {
    app.toast('원격 저장소가 없습니다', 'warn')
    return
  }
  await repo.run({ kind: 'pushTag', remote, name }, '태그 push', `태그 ${name}을(를) ${remote}에 올렸습니다`)
}

export async function deleteTag(repo: Repo, name: string) {
  if (await app.confirm('태그 삭제', `로컬 태그 ${name}을(를) 지웁니다. 원격에 올린 태그는 그대로입니다.`, { ok: '삭제', danger: true }))
    await repo.run({ kind: 'tagDelete', name }, '태그 삭제', `태그 ${name}을(를) 지웠습니다`)
}

export async function cherryPick(repo: Repo, sha: string, subject: string) {
  if (await app.confirm('cherry-pick', `${short(sha)} ${subject}\n이 커밋의 변경을 지금 브랜치(${repo.status?.branch ?? 'HEAD'})에 새 커밋으로 가져옵니다.`, { ok: 'cherry-pick' }))
    await repo.run({ kind: 'cherryPick', rev: sha }, 'cherry-pick', `${short(sha)}을(를) 가져왔습니다`)
}

export async function revert(repo: Repo, sha: string, subject: string) {
  if (await app.confirm('되돌리는 커밋 만들기 (revert)', `${short(sha)} ${subject}\n이 커밋의 변경을 거꾸로 적용한 새 커밋을 만듭니다. 기존 이력은 그대로 남습니다.`, { ok: 'revert' }))
    await repo.run({ kind: 'revert', rev: sha }, 'revert', `${short(sha)}을(를) 되돌리는 커밋을 만들었습니다`)
}

const STATE_NAME: Record<string, string> = { merging: '병합', rebasing: 'rebase', 'cherry-picking': 'cherry-pick', reverting: 'revert' }

export async function abortState(repo: Repo) {
  const st = repo.status?.state
  if (!st) return
  const name = STATE_NAME[st] ?? st
  if (await app.confirm(`${name} 중단`, `진행 중인 ${name} 작업을 그만두고 시작하기 전 상태로 돌아갑니다. 충돌을 해결하던 내용은 사라집니다.`, { ok: '중단', danger: true }))
    await repo.run({ kind: 'abort' }, `${name} 중단`, `${name} 작업을 중단했습니다`)
}

export async function continueState(repo: Repo) {
  const st = repo.status?.state
  if (!st) return
  if (repo.status?.conflicted.length) {
    app.toast(`충돌 파일 ${repo.status.conflicted.length}개가 남아 있습니다. 고친 뒤 스테이지하세요`, 'warn')
    return
  }
  const name = STATE_NAME[st] ?? st
  await repo.run({ kind: 'continue' }, `${name} 계속`, `${name} 작업을 마쳤습니다`)
}
