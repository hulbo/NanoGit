<script lang="ts">
  // 툴바 (소스트리 자리 배치): 조작(커밋·Pull·Push·Fetch·브랜치·병합·Stash) | 화면 | 도구.
  // 감시 전용 모드면 조작 버튼을 숨긴다. 창이 좁으면 글자를 숨기고 아이콘만 보인다
  import * as act from '../actions'
  import { app, type Repo, type View } from '../state.svelte'
  import Icon, { type IconName } from './Icon.svelte'

  let { repo }: { repo: Repo } = $props()

  let fetching = $state(false)
  let width = $state(1400)

  async function fetch() {
    fetching = true
    await app.fetch(repo)
    fetching = false
  }

  async function refresh() {
    await repo.refreshNow()
  }

  function commit() {
    repo.setView('status')
    app.commitFocus = Date.now()
  }

  const views: [View, string, IconName, string][] = [
    ['status', '파일 상태', 'status', 'Ctrl+1'],
    ['history', '히스토리', 'history', 'Ctrl+2'],
    ['activity', '활동', 'activity', 'Ctrl+3'],
    ['outgoing', 'Push 대기', 'push', 'Ctrl+4'],
  ]

  const write = $derived(app.canWrite)
  const compact = $derived(width < (write ? 1240 : 880))
  const busy = $derived(!!repo.busy)
  const staged = $derived(repo.status?.staged.length ?? 0)
  const behind = $derived(repo.status?.behind ?? 0)
</script>

<div class="bar" class:compact bind:clientWidth={width}>
  {#if write}
    <button class="tool" title="커밋 (파일 상태의 커밋 입력란으로)" onclick={commit}>
      <span class="ic"><Icon name="commit" size={20} />{#if staged}<span class="num ok">{staged}</span>{/if}</span><span class="lb">커밋</span>
    </button>
    <button class="tool" title="Pull (원격에서 가져와 합치기)" disabled={busy} onclick={() => act.pull(repo)}>
      <span class="ic" class:spin-y={repo.busy === 'pull'}><Icon name="pull" size={20} />{#if behind}<span class="num warn">{behind}</span>{/if}</span><span class="lb">Pull</span>
    </button>
    <button class="tool" title="Push (올라갈 커밋을 확인하고 올리기)" disabled={busy} onclick={() => act.push(repo)}>
      <span class="ic"><Icon name="push" size={20} />{#if repo.aheadCount}<span class="num">{repo.aheadCount}</span>{/if}</span><span class="lb">Push</span>
    </button>
  {/if}
  <button class="tool" title="원격 가져오기 (git fetch --all --prune)" disabled={fetching} onclick={fetch}>
    <span class="ic" class:spin={fetching}><Icon name="fetch" size={20} /></span><span class="lb">{fetching ? '가져오는 중' : 'Fetch'}</span>
  </button>
  {#if write}
    <span class="sep"></span>
    <button class="tool" title="새 브랜치" disabled={busy} onclick={() => act.createBranch(repo)}>
      <span class="ic"><Icon name="branch" size={20} /></span><span class="lb">브랜치</span>
    </button>
    <button class="tool" title="다른 브랜치를 지금 브랜치에 병합" disabled={busy} onclick={() => act.merge(repo)}>
      <span class="ic"><Icon name="merge" size={20} /></span><span class="lb">병합</span>
    </button>
    <button class="tool" title="Stash (변경 잠시 보관)" disabled={busy} onclick={() => act.stash(repo)}>
      <span class="ic"><Icon name="stash" size={20} /></span><span class="lb">Stash</span>
    </button>
  {/if}
  <span class="sep"></span>
  {#each views as [v, label, icon, key] (v)}
    <button class="tool" class:on={repo.view === v} title="{label} ({key})" onclick={() => repo.setView(v)}>
      <span class="ic">
        <Icon name={icon} size={20} />
        {#if v === 'status' && repo.changeCount}<span class="num warn">{repo.changeCount}</span>{/if}
        {#if v === 'outgoing' && repo.aheadCount}<span class="num">{repo.aheadCount}</span>{/if}
        {#if v === 'activity' && repo.unseen}<span class="num err">{repo.unseen}</span>{/if}
      </span><span class="lb">{label}</span>
    </button>
  {/each}
  <span class="sep"></span>
  <button class="tool" title="파일을 찾아 이력 조회 (Ctrl+Shift+R, Ctrl+P) · *, ?로 like 검색" onclick={() => (app.quickOpen = true)}>
    <span class="ic"><Icon name="search" size={20} /></span><span class="lb">파일 찾기</span>
  </button>
  <button class="tool" title="파일 내용에서 찾기 (Ctrl+H) · 결과를 고르면 그 파일의 이력에서 그 줄을 봅니다" onclick={() => (app.findInFiles = true)}>
    <span class="ic"><Icon name="lines" size={20} /></span><span class="lb">내용 찾기</span>
  </button>
  <span class="grow"></span>
  {#if repo.busy}<span class="busy" title="진행 중인 조작"><span class="ic spin"><Icon name="refresh" size={14} /></span>{repo.busy} 중…</span>{/if}
  <button class="tool" title="새로고침 (F5)" disabled={repo.refreshing} onclick={refresh}>
    <span class="ic" class:spin={repo.refreshing}><Icon name="refresh" size={20} /></span><span class="lb">새로고침</span>
  </button>
  <button class="tool" title="이 저장소에서 터미널 열기" onclick={() => app.run(() => app.backend.openTerminal(repo.root))}>
    <span class="ic"><Icon name="terminal" size={20} /></span><span class="lb">터미널</span>
  </button>
  <button class="tool" title="탐색기에서 열기" onclick={() => app.run(() => app.backend.openPath(repo.root))}>
    <span class="ic"><Icon name="folder" size={20} /></span><span class="lb">탐색기</span>
  </button>
  <button class="tool" title="편집기로 열기" onclick={() => app.run(() => app.backend.openEditor(repo.root))}>
    <span class="ic"><Icon name="editor" size={20} /></span><span class="lb">편집기</span>
  </button>
  <button class="tool" title="설정" onclick={() => (app.settingsOpen = true)}>
    <span class="ic"><Icon name="gear" size={20} /></span><span class="lb">설정</span>
  </button>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 56px;
    padding: 0 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--border-strong);
    flex: none;
    overflow: hidden;
  }
  .tool {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 58px;
    height: 48px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--text-2);
    font-size: 11.5px;
    white-space: nowrap;
    cursor: pointer;
  }
  .compact .tool {
    min-width: 40px;
    height: 40px;
    padding: 0 6px;
  }
  .compact .lb {
    display: none;
  }
  .tool:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }
  .tool.on {
    background: var(--sel);
    color: var(--text);
  }
  .tool:disabled {
    color: var(--muted);
    cursor: default;
  }
  .ic {
    position: relative;
  }
  .spin {
    display: inline-grid;
    animation: spin 0.9s linear infinite;
  }
  .spin-y {
    animation: bob 0.8s ease-in-out infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes bob {
    50% {
      transform: translateY(3px);
    }
  }
  .num {
    position: absolute;
    top: -6px;
    right: -14px;
    min-width: 17px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }
  .num.warn {
    background: var(--warn);
    color: #1e1f22;
  }
  .num.err {
    background: var(--err);
  }
  .num.ok {
    background: var(--ok);
    color: #1e1f22;
  }
  .busy {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 8px;
    color: var(--accent-text);
    font-size: 12px;
    white-space: nowrap;
  }
  .sep {
    width: 1px;
    height: 32px;
    margin: 0 6px;
    background: var(--border-strong);
    flex: none;
  }
  .grow {
    flex: 1;
  }
</style>
