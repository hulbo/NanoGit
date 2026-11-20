<script lang="ts">
  import ActivityView from './lib/components/ActivityView.svelte'
  import ContextMenu from './lib/components/ContextMenu.svelte'
  import FileHistoryView from './lib/components/FileHistoryView.svelte'
  import FilesView from './lib/components/FilesView.svelte'
  import HistoryView from './lib/components/HistoryView.svelte'
  import Icon from './lib/components/Icon.svelte'
  import OutgoingView from './lib/components/OutgoingView.svelte'
  import OverviewView from './lib/components/OverviewView.svelte'
  import QuickOpen from './lib/components/QuickOpen.svelte'
  import RepoTabs from './lib/components/RepoTabs.svelte'
  import SettingsDialog from './lib/components/SettingsDialog.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import StatusView from './lib/components/StatusView.svelte'
  import Toasts from './lib/components/Toasts.svelte'
  import Toolbar from './lib/components/Toolbar.svelte'
  import Welcome from './lib/components/Welcome.svelte'
  import { app, OVERVIEW, type View } from './lib/state.svelte'
  import { traySummary } from './lib/tray'

  void app.init()

  const repo = $derived(app.active)
  let sideWidth = $state(app.settings.sidebarWidth)
  let dragging = false

  $effect(() => {
    sideWidth = app.settings.sidebarWidth
  })

  // 트레이 툴팁·메뉴: 저장소마다 변경 수·push 대기·새 활동
  $effect(() => {
    if (!app.ready) return
    app.queueTray(
      traySummary(
        app.tabs.map((t) => ({ root: t.root, name: t.name, branch: t.status?.branch ?? null, changes: t.changeCount, ahead: t.aheadCount, unseen: t.unseen })),
        app.settings.notifyEnabled,
      ),
    )
  })

  function onkey(e: KeyboardEvent) {
    const r = app.active
    if (e.key === 'F5') {
      e.preventDefault()
      void r?.refreshAll()
      return
    }
    if (!e.ctrlKey) return
    if (e.key === 'Tab') {
      e.preventDefault()
      app.moveTab(e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === '0' && app.tabs.length) {
      e.preventDefault()
      app.select(OVERVIEW)
      return
    }
    if (!r) return
    const views: Record<string, View> = { '1': 'status', '2': 'history', '3': 'activity', '4': 'outgoing', '5': 'files' }
    if (views[e.key]) {
      e.preventDefault()
      r.setView(views[e.key])
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault()
      app.quickOpen = true
    } else if (e.key === 'w' || e.key === 'W') {
      e.preventDefault()
      void app.closeTab(r.root)
    }
  }

  function sideDown(e: PointerEvent) {
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function sideMove(e: PointerEvent) {
    if (dragging) sideWidth = Math.max(160, Math.min(480, e.clientX))
  }
  function sideUp() {
    if (!dragging) return
    dragging = false
    app.settings.sidebarWidth = Math.round(sideWidth)
    void app.persist()
  }

  const stateName: Record<string, string> = { merging: '병합 중', rebasing: 'rebase 중', 'cherry-picking': 'cherry-pick 중', reverting: 'revert 중', bisecting: 'bisect 중' }
</script>

<svelte:window onkeydown={onkey} onfocus={() => app.active?.refreshStatus()} />

<div class="app">
  {#if app.ready}
    {#if app.tabs.length}
      <RepoTabs />
    {/if}
    {#if app.onOverview}
      <div class="overview"><OverviewView /></div>
      <footer>
        <span>저장소 {app.tabs.length}개</span>
        <span class="grow"></span>
        <span class="watch" title="파일·git 변화를 실시간으로 감시합니다"><span class="live"></span>감시 중</span>
        <span class="muted">NanoGit {app.info?.version ?? ''}</span>
      </footer>
    {:else if repo}
      {#key repo.root}
        <Toolbar {repo} />
        <div class="body">
          <div class="side" style="width:{sideWidth}px">
            <Sidebar {repo} />
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="side-handle" onpointerdown={sideDown} onpointermove={sideMove} onpointerup={sideUp}></div>
          <main>
            {#if repo.error && !repo.status}
              <div class="empty err">
                <div>
                  <Icon name="warning" size={22} />
                  <p>{repo.error}</p>
                  <button class="ghost on" onclick={() => repo.refreshAll()}>다시 시도</button>
                  <button class="ghost" onclick={() => app.closeTab(repo.root)}>탭 닫기</button>
                </div>
              </div>
            {:else if repo.view === 'status'}
              <StatusView {repo} />
            {:else if repo.view === 'history'}
              <HistoryView {repo} />
            {:else if repo.view === 'activity'}
              <ActivityView {repo} />
            {:else if repo.view === 'outgoing'}
              <OutgoingView {repo} />
            {:else if repo.view === 'files'}
              <FilesView {repo} />
            {:else if repo.view === 'fileHistory'}
              <FileHistoryView {repo} />
            {/if}
          </main>
        </div>
        <footer>
          {#if repo.status}
            {@const s = repo.status}
            <span class="fi"><Icon name="branch" size={13} />{s.branch ?? `분리된 HEAD ${s.head?.slice(0, 7) ?? ''}`}</span>
            {#if s.upstream}<span class="muted">→ {s.upstream}</span>{:else if s.branch}<span class="muted">추적 브랜치 없음</span>{/if}
            {#if s.ahead}<span class="up">↑{s.ahead}</span>{/if}
            {#if s.behind}<span class="down">↓{s.behind}</span>{/if}
            <span class="sep">·</span>
            <span>변경 {repo.changeCount}</span>
            {#if s.state}<span class="state">{stateName[s.state] ?? s.state}</span>{/if}
          {/if}
          <span class="grow"></span>
          <span class="watch" title="파일·git 변화를 실시간으로 감시합니다"><span class="live"></span>감시 중</span>
          <span class="muted">{repo.root}</span>
          <span class="muted">NanoGit {app.info?.version ?? ''}</span>
        </footer>
      {/key}
    {:else}
      <Welcome />
    {/if}
  {:else}
    <div class="empty">시작하는 중…</div>
  {/if}
</div>

{#if app.menu}
  <ContextMenu x={app.menu.x} y={app.menu.y} items={app.menu.items} onclose={() => (app.menu = null)} />
{/if}
{#if app.quickOpen && app.active}
  <QuickOpen repo={app.active} />
{/if}
{#if app.settingsOpen}
  <SettingsDialog />
{/if}
<Toasts />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .overview {
    flex: 1;
    min-height: 0;
  }
  .side {
    flex: none;
    min-width: 0;
    border-right: 1px solid var(--border-strong);
  }
  .side-handle {
    width: 4px;
    margin-left: -3px;
    cursor: col-resize;
    position: relative;
    z-index: 3;
    flex: none;
  }
  .side-handle:hover {
    background: var(--accent);
  }
  main {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 24px;
    padding: 0 10px;
    border-top: 1px solid var(--border-strong);
    background: var(--panel);
    font-size: 12px;
    flex: none;
    white-space: nowrap;
    overflow: hidden;
  }
  .fi {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }
  .up {
    color: var(--accent-text);
    font-weight: 600;
  }
  .down {
    color: var(--warn);
    font-weight: 600;
  }
  .sep {
    color: var(--faint);
  }
  .state {
    padding: 0 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--warn) 25%, transparent);
    color: var(--warn);
  }
  .grow {
    flex: 1;
  }
  .watch {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--ok);
  }
  .live {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .err {
    color: var(--err);
  }
  .err p {
    max-width: 520px;
    white-space: pre-wrap;
    user-select: text;
  }
</style>
