<script lang="ts">
  // 저장소 탭 (소스트리처럼). 바뀌는 중인 저장소는 점이 깜빡인다
  import type { MenuEntry } from './ContextMenu.svelte'
  import { app } from '../state.svelte'
  import Icon from './Icon.svelte'

  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(t)
  })

  function addMenu(e: MouseEvent) {
    const open = new Set(app.tabs.map((t) => t.root.toLowerCase()))
    const recent = app.settings.repos.filter((r) => !open.has(r.path.toLowerCase()))
    const items: MenuEntry[] = [{ label: '저장소 추가…', icon: 'folder', action: () => app.addRepo() }]
    if (recent.length) {
      items.push('separator')
      for (const r of recent.slice(0, 15)) items.push({ label: `${r.name}  —  ${r.path}`, icon: 'branch', action: () => app.addRepo(r.path) })
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    app.menu = { x: rect.left, y: rect.bottom + 2, items }
  }

  function tabMenu(e: MouseEvent, root: string) {
    app.openMenu(e, [
      { label: '탭 닫기', icon: 'x', action: () => app.closeTab(root) },
      { label: '다른 탭 모두 닫기', action: () => app.tabs.filter((t) => t.root !== root).forEach((t) => app.closeTab(t.root)) },
      'separator',
      { label: '경로 복사', icon: 'copy', action: () => app.copy(root, '경로') },
      { label: '탐색기에서 열기', icon: 'folder', action: () => app.run(() => app.backend.openPath(root)) },
    ])
  }
</script>

<div class="tabs" role="tablist">
  {#each app.tabs as t (t.root)}
    {@const active = t.root === app.activeRoot}
    {@const live = now - t.pulse < 4000}
    <div
      class="tab"
      class:active
      role="tab"
      tabindex="0"
      aria-selected={active}
      title={t.root}
      onclick={() => app.select(t.root)}
      onkeydown={(e) => e.key === 'Enter' && app.select(t.root)}
      onauxclick={(e) => e.button === 1 && app.closeTab(t.root)}
      oncontextmenu={(e) => tabMenu(e, t.root)}
    >
      <span class="dot" class:live class:err={!!t.error}></span>
      <span class="name">{t.name}</span>
      {#if t.status?.branch}<span class="branch">{t.status.branch}</span>{/if}
      {#if t.changeCount}<span class="badge changes" title="커밋하지 않은 변경">{t.changeCount}</span>{/if}
      {#if t.aheadCount}<span class="badge ahead" title="push 대기 커밋">↑{t.aheadCount}</span>{/if}
      {#if t.unseen}<span class="badge unseen" title="확인하지 않은 새 활동">{t.unseen}</span>{/if}
      <button
        class="close"
        title="닫기"
        onclick={(e) => {
          e.stopPropagation()
          app.closeTab(t.root)
        }}><Icon name="x" size={11} /></button
      >
    </div>
  {/each}
  <button class="add" title="저장소 열기" onclick={addMenu}><Icon name="plus" size={14} /></button>
</div>

<style>
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 34px;
    padding: 0 6px;
    background: var(--panel-2);
    border-bottom: 1px solid var(--border-strong);
    overflow-x: auto;
    overflow-y: hidden;
    flex: none;
  }
  .tabs::-webkit-scrollbar {
    height: 0;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 29px;
    max-width: 320px;
    padding: 0 6px 0 10px;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 7px 7px 0 0;
    color: var(--text-2);
    cursor: default;
    flex: none;
  }
  .tab:hover {
    background: var(--hover);
  }
  .tab.active {
    background: var(--bg);
    border-color: var(--border-strong);
    color: var(--text);
    margin-bottom: -1px;
    height: 30px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--faint);
    flex: none;
  }
  .dot.live {
    background: var(--warn);
    animation: pulse 1s ease-in-out infinite;
  }
  .dot.err {
    background: var(--err);
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .branch {
    color: var(--muted);
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }
  .badge {
    padding: 0 5px;
    border-radius: 8px;
    font-size: 10.5px;
    font-weight: 700;
    line-height: 16px;
    flex: none;
  }
  .changes {
    background: color-mix(in srgb, var(--warn) 25%, transparent);
    color: var(--warn);
  }
  .ahead {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent-text);
  }
  .unseen {
    background: var(--err);
    color: #fff;
  }
  .close,
  .add {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    flex: none;
  }
  .close:hover,
  .add:hover {
    background: var(--hover-strong);
    color: var(--text);
  }
  .add {
    align-self: center;
    margin-left: 4px;
  }
</style>
