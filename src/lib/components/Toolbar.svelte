<script lang="ts">
  // 툴바 (소스트리 자리 배치). 1차는 감시용 버튼만 둔다. 커밋·Pull·Push 같은 조작 버튼은 M3에서 같은 자리에 들어온다
  import { app, type Repo, type View } from '../state.svelte'
  import Icon, { type IconName } from './Icon.svelte'

  let { repo }: { repo: Repo } = $props()

  let fetching = $state(false)
  let refreshing = $state(false)

  async function fetch() {
    fetching = true
    await app.fetch(repo)
    fetching = false
  }

  async function refresh() {
    refreshing = true
    await repo.refreshAll()
    refreshing = false
  }

  const views: [View, string, IconName, string][] = [
    ['status', '파일 상태', 'status', 'Ctrl+1'],
    ['history', '히스토리', 'history', 'Ctrl+2'],
    ['activity', '활동', 'activity', 'Ctrl+3'],
    ['outgoing', 'Push 대기', 'push', 'Ctrl+4'],
  ]
</script>

<div class="bar">
  <button class="tool" title="새로고침 (F5)" disabled={refreshing} onclick={refresh}>
    <span class="ic" class:spin={refreshing}><Icon name="refresh" size={20} /></span>새로고침
  </button>
  <button class="tool" title="원격 가져오기 (git fetch --all --prune)" disabled={fetching} onclick={fetch}>
    <span class="ic" class:spin={fetching}><Icon name="fetch" size={20} /></span>{fetching ? '가져오는 중' : 'Fetch'}
  </button>
  <span class="sep"></span>
  {#each views as [v, label, icon, key] (v)}
    <button class="tool" class:on={repo.view === v} title="{label} ({key})" onclick={() => repo.setView(v)}>
      <span class="ic">
        <Icon name={icon} size={20} />
        {#if v === 'status' && repo.changeCount}<span class="num warn">{repo.changeCount}</span>{/if}
        {#if v === 'outgoing' && repo.aheadCount}<span class="num">{repo.aheadCount}</span>{/if}
        {#if v === 'activity' && repo.unseen}<span class="num err">{repo.unseen}</span>{/if}
      </span>{label}
    </button>
  {/each}
  <span class="sep"></span>
  <button class="tool" title="파일을 찾아 이력 조회 (Ctrl+P)" onclick={() => (app.quickOpen = true)}>
    <span class="ic"><Icon name="search" size={20} /></span>파일 찾기
  </button>
  <span class="grow"></span>
  <button class="tool" title="이 저장소에서 터미널 열기" onclick={() => app.run(() => app.backend.openTerminal(repo.root))}>
    <span class="ic"><Icon name="terminal" size={20} /></span>터미널
  </button>
  <button class="tool" title="탐색기에서 열기" onclick={() => app.run(() => app.backend.openPath(repo.root))}>
    <span class="ic"><Icon name="folder" size={20} /></span>탐색기
  </button>
  <button class="tool" title="편집기로 열기" onclick={() => app.run(() => app.backend.openEditor(repo.root))}>
    <span class="ic"><Icon name="editor" size={20} /></span>편집기
  </button>
  <button class="tool" title="설정" onclick={() => (app.settingsOpen = true)}>
    <span class="ic"><Icon name="gear" size={20} /></span>설정
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
    min-width: 62px;
    height: 48px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--text-2);
    font-size: 11.5px;
    white-space: nowrap;
    cursor: pointer;
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
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
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
