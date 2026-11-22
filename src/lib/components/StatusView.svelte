<script lang="ts">
  // 파일 상태 (작업 트리): 스테이지된 / 스테이지 안 된 파일과 diff. 실시간으로 갱신된다.
  // 직접 조작(M3): 파일·헝크 단위 스테이지·언스테이지·버리기, 아래 커밋 입력란, 병합 중이면 계속·중단
  import * as act from '../actions'
  import { errorMessage } from '../api'
  import { fileMenu } from '../menus'
  import { app, type Repo } from '../state.svelte'
  import type { DiffTarget, TextBlob, WorkFile } from '../types'
  import DiffView, { type HunkAction } from './DiffView.svelte'
  import FileList from './FileList.svelte'
  import Icon from './Icon.svelte'
  import Split from './Split.svelte'

  let { repo }: { repo: Repo } = $props()

  type Group = 'staged' | 'unstaged' | 'conflicted'
  let pick = $state<{ group: Group; path: string } | null>(null)
  let sort = $state<'recent' | 'path'>('recent')
  let tree = $state(false)
  let blob = $state<TextBlob | null>(null)
  let error = $state<string | null>(null)
  let loading = $state(false)
  let now = $state(Date.now())
  let seq = 0

  // "방금"·"12초 전" 표시를 갱신한다
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 5000)
    return () => clearInterval(t)
  })

  const sorted = (list: WorkFile[]) =>
    sort === 'recent' ? [...list].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || a.path.localeCompare(b.path)) : [...list].sort((a, b) => a.path.localeCompare(b.path))

  const staged = $derived(sorted(repo.status?.staged ?? []))
  const unstaged = $derived(sorted(repo.status?.unstaged ?? []))
  const conflicted = $derived(sorted(repo.status?.conflicted ?? []))

  const listOf = (g: Group) => (g === 'staged' ? staged : g === 'unstaged' ? unstaged : conflicted)

  const current = $derived.by(() => {
    if (!pick) return null
    return listOf(pick.group).find((f) => f.path === pick!.path) ?? null
  })

  // 처음엔 충돌 파일, 없으면 가장 최근에 바뀐 파일을 고른다. 고른 파일이 사라지면 다시 고른다
  $effect(() => {
    if (current) return
    const group: Group | null = conflicted.length ? 'conflicted' : unstaged.length ? 'unstaged' : staged.length ? 'staged' : null
    pick = group ? { group, path: listOf(group)[0].path } : null
  })

  // 파일이 바뀌면(mtime)·스테이지가 바뀌면 diff를 다시 읽는다
  const diffKey = $derived(
    current && pick ? `${pick.group}:${current.path}:${current.mtime}:${current.status}:${repo.status?.head}:${repo.indexSeq}:${app.settings.ignoreWhitespace}` : '',
  )
  $effect(() => {
    const key = diffKey
    const f = current
    const g = pick?.group
    if (!key || !f || !g) {
      blob = null
      return
    }
    const target: DiffTarget =
      g === 'staged' ? { kind: 'staged', path: f.path, oldPath: f.oldPath } : { kind: 'worktree', path: f.path, untracked: f.status === '?' }
    const my = ++seq
    loading = true
    error = null
    app.backend
      .diff(repo.root, target, { ignoreWhitespace: app.settings.ignoreWhitespace })
      .then((b) => {
        if (my === seq) blob = b
      })
      .catch((e) => {
        if (my === seq) {
          error = errorMessage(e)
          blob = null
        }
      })
      .finally(() => {
        if (my === seq) loading = false
      })
  })

  const menu = (group: Group) => (e: MouseEvent, f: { path: string; status: string }) => {
    const file = listOf(group).find((x) => x.path === f.path)
    app.openMenu(e, fileMenu(repo, { path: f.path, deleted: f.status === 'D', work: file ? { group, file } : undefined }))
  }
  /** 줄 버튼(＋·－)으로 파일 하나 */
  const one = (group: Group, run: (files: WorkFile[]) => unknown) => (f: { path: string }) => {
    const file = listOf(group).find((x) => x.path === f.path)
    if (file) void run([file])
  }

  // 헝크 단위 조작: 수정(M)된 파일만 (새 파일·이름 변경은 파일 단위로)
  const hunkActions = $derived.by((): HunkAction[] => {
    const f = current
    const g = pick?.group
    if (!app.canWrite || !f || f.status !== 'M') return []
    if (g === 'unstaged')
      return [
        { label: '스테이지', icon: 'plus', run: (h) => repo.run({ kind: 'hunk', path: f.path, header: h, action: 'stage' }, '헝크 스테이지') },
        { label: '버리기', icon: 'trash', danger: true, run: (h) => discardHunk(f.path, h) },
      ]
    if (g === 'staged') return [{ label: '언스테이지', icon: 'minus', run: (h) => repo.run({ kind: 'hunk', path: f.path, header: h, action: 'unstage' }, '헝크 언스테이지') }]
    return []
  })

  async function discardHunk(path: string, header: string) {
    const range = header.match(/^@@[^@]*@@/)?.[0] ?? header
    const ok = await app.confirm('이 부분 버리기', `${path}에서 이 부분(${range})의 변경을 버립니다. 지금 파일 사본은 휴지통에 남습니다.`, { ok: '버리기', danger: true })
    if (ok) await repo.run({ kind: 'hunk', path, header, action: 'discard' }, '헝크 버리기')
  }

  // 커밋 입력란
  let msgBox: HTMLTextAreaElement | undefined = $state()
  $effect(() => {
    // 툴바의 커밋 버튼을 누른 직후면 입력란으로
    if (msgBox && Date.now() - app.commitFocus < 1500) msgBox.focus()
  })
  const amendWarn = $derived(repo.amend && !!repo.status?.upstream && repo.outgoing !== null && !!repo.status?.head && !repo.unpushed.has(repo.status.head))
  const committing = $derived(repo.busy === '커밋' || repo.busy === '커밋 고치기(amend)')
  const stateName: Record<string, string> = { merging: '병합', rebasing: 'rebase', 'cherry-picking': 'cherry-pick', reverting: 'revert', bisecting: 'bisect' }

  /** amend를 켜며 불러온 메시지: 끄면 (고치지 않았을 때) 지운다 */
  let loaded: string | null = null
  async function toggleAmend() {
    if (repo.amend) loaded = await act.loadAmendMessage(repo)
    else if (loaded !== null && repo.draft === loaded) repo.draft = ''
  }
  function togglePush(e: Event) {
    app.settings.commitPush = (e.currentTarget as HTMLInputElement).checked
    void app.persist()
  }
  function commitKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      void act.commit(repo)
    }
  }
</script>

<Split key="status" initial={0.36} min={240}>
  {#snippet a()}
    <div class="lists">
      <div class="pane-head">
        <span class="title">파일 상태</span>
        <span class="grow"></span>
        <select bind:value={sort} title="정렬">
          <option value="recent">최근 변경순</option>
          <option value="path">경로순</option>
        </select>
        <div class="seg">
          <button class:on={!tree} title="목록" onclick={() => (tree = false)}><Icon name="list" size={13} /></button>
          <button class:on={tree} title="트리" onclick={() => (tree = true)}><Icon name="tree" size={13} /></button>
        </div>
      </div>
      {#if repo.status?.state}
        {@const name = stateName[repo.status.state] ?? repo.status.state}
        <div class="banner">
          <Icon name="warning" size={14} />
          <span class="btext">
            <b>{name} 중</b>
            {#if conflicted.length}· 충돌 {conflicted.length}개: 파일을 고친 뒤 스테이지하고 계속하세요{:else}· 충돌을 모두 해결했으면 계속하세요{/if}
          </span>
          {#if app.canWrite && repo.status.state !== 'bisecting'}
            <button class="ghost" disabled={!!repo.busy || conflicted.length > 0} onclick={() => act.continueState(repo)}>계속</button>
            <button class="ghost danger" disabled={!!repo.busy} onclick={() => act.abortState(repo)}>중단</button>
          {/if}
        </div>
      {/if}
      <div class="scroll">
        {#if conflicted.length}
          <div class="group warn"><Icon name="warning" size={13} />충돌 ({conflicted.length})</div>
          <FileList
            files={conflicted}
            {tree}
            showTime
            {now}
            selected={pick?.group === 'conflicted' ? pick.path : null}
            onselect={(f) => (pick = { group: 'conflicted', path: f.path })}
            oncontext={menu('conflicted')}
            action={app.canWrite ? { icon: 'check', title: '해결됨으로 표시 (스테이지)', run: one('conflicted', (fs) => act.stage(repo, fs)) } : undefined}
          />
        {/if}
        <div class="group">
          스테이지된 파일 ({staged.length})
          <span class="grow"></span>
          {#if app.canWrite && staged.length}
            <button class="gbtn" disabled={!!repo.busy} title="모두 언스테이지" onclick={() => act.unstage(repo, staged)}><Icon name="minus" size={12} />모두</button>
          {/if}
        </div>
        {#if staged.length}
          <FileList
            files={staged}
            {tree}
            showTime
            {now}
            selected={pick?.group === 'staged' ? pick.path : null}
            onselect={(f) => (pick = { group: 'staged', path: f.path })}
            oncontext={menu('staged')}
            ondblclick={(f) => repo.openFileHistory({ path: f.path })}
            action={app.canWrite ? { icon: 'minus', title: '언스테이지', run: one('staged', (fs) => act.unstage(repo, fs)) } : undefined}
          />
        {:else}
          <div class="none">없음</div>
        {/if}
        <div class="group">
          스테이지 안 된 파일 ({unstaged.length})
          <span class="grow"></span>
          {#if app.canWrite && unstaged.length}
            <button class="gbtn" disabled={!!repo.busy} title="모두 스테이지" onclick={() => act.stage(repo, unstaged)}><Icon name="plus" size={12} />모두</button>
          {/if}
        </div>
        {#if unstaged.length}
          <FileList
            files={unstaged}
            {tree}
            showTime
            {now}
            selected={pick?.group === 'unstaged' ? pick.path : null}
            onselect={(f) => (pick = { group: 'unstaged', path: f.path })}
            oncontext={menu('unstaged')}
            ondblclick={(f) => repo.openFileHistory({ path: f.path })}
            action={app.canWrite ? { icon: 'plus', title: '스테이지', run: one('unstaged', (fs) => act.stage(repo, fs)) } : undefined}
          />
        {:else}
          <div class="none">없음</div>
        {/if}
        {#if repo.status?.truncated}<div class="none warn">파일이 너무 많아 일부만 보여 줍니다</div>{/if}
      </div>
      {#if app.canWrite}
        <div class="commit">
          <textarea
            bind:this={msgBox}
            bind:value={repo.draft}
            rows="3"
            spellcheck="false"
            placeholder={repo.amend ? '고칠 커밋 메시지' : '커밋 메시지 (첫 줄은 제목) · Ctrl+Enter로 커밋'}
            onkeydown={commitKey}
          ></textarea>
          {#if amendWarn}<div class="cnote warn"><Icon name="warning" size={12} />이미 push한 커밋입니다. 고치면 강제 push가 필요합니다</div>{/if}
          <div class="crow">
            <label class="chk" title="마지막 커밋에 지금 스테이지를 더하고 메시지를 바꿉니다 (git commit --amend)">
              <input type="checkbox" bind:checked={repo.amend} onchange={toggleAmend} />마지막 커밋 고치기
            </label>
            <label class="chk" title="커밋한 뒤 추적 브랜치로 바로 push">
              <input type="checkbox" checked={app.settings.commitPush} onchange={togglePush} />커밋 후 push
            </label>
            <span class="grow"></span>
            <button
              class="cbtn"
              disabled={!!repo.busy || !repo.draft.trim() || (!staged.length && !repo.amend)}
              title={!staged.length && !repo.amend ? '스테이지된 파일이 없습니다' : '커밋 (Ctrl+Enter)'}
              onclick={() => act.commit(repo)}
            >
              {committing ? '커밋하는 중…' : repo.amend ? '커밋 고치기' : `커밋${staged.length ? ` (${staged.length})` : ''}`}
            </button>
          </div>
        </div>
      {:else}
        <div class="foot muted">
          <Icon name="eye" size={13} />
          감시 전용 모드: AI가 파일을 바꾸면 바로 반영됩니다. 커밋·스테이지는 AI에게 맡기세요.
        </div>
      {/if}
    </div>
  {/snippet}
  {#snippet b()}
    {#if !staged.length && !unstaged.length && !conflicted.length}
      <div class="empty clean">
        <div>
          <div class="big"><Icon name="check" size={28} /></div>
          작업 트리가 깨끗합니다
        </div>
      </div>
    {:else}
      <DiffView {blob} {loading} {error} {hunkActions} title={current ? `${pick?.group === 'staged' ? '스테이지됨 · ' : ''}${current.path}` : ''} />
    {/if}
  {/snippet}
</Split>

<style>
  .lists {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    background: var(--panel-2);
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .group.warn,
  .warn {
    color: var(--warn);
  }
  .grow {
    flex: 1;
  }
  .none {
    padding: 6px 12px;
    color: var(--faint);
    font-size: 12px;
  }
  .gbtn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text-2);
    font-size: 11px;
    font-weight: 400;
    cursor: pointer;
  }
  .gbtn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text);
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-strong);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    color: var(--warn);
    font-size: 12px;
  }
  .btext {
    flex: 1;
    min-width: 0;
  }
  .banner button {
    flex: none;
  }
  .danger {
    color: var(--err);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
  }
  .commit {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid var(--border-strong);
    background: var(--panel);
  }
  .commit textarea {
    width: 100%;
    min-height: 56px;
    max-height: 40vh;
    resize: vertical;
    font: inherit;
    font-size: 12.5px;
  }
  .crow {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    cursor: pointer;
  }
  .cnote {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
  }
  .cbtn {
    padding: 4px 14px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .cbtn:disabled {
    border-color: var(--border-strong);
    background: var(--hover);
    color: var(--muted);
    cursor: default;
  }
  .clean .big {
    display: grid;
    place-items: center;
    margin-bottom: 8px;
    color: var(--ok);
  }
</style>
