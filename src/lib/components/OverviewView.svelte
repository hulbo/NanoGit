<script lang="ts">
  // 저장소 요약: 열어 둔 모든 저장소를 카드로, 오른쪽에 모든 저장소의 활동을 시간순으로
  import { onMount } from 'svelte'
  import { describe } from '../activity'
  import { basename, relative, shortDate, statusName } from '../format'
  import { lastChange, mergeFeed, recentFiles, sortRepos, warningCount, type RepoSort } from '../overview'
  import { app, type Repo, type View } from '../state.svelte'
  import Icon from './Icon.svelte'

  let now = $state(Date.now())
  const loadSort = (): RepoSort => {
    try {
      const v = localStorage.getItem('overview:sort')
      return v === 'name' || v === 'tabs' ? v : 'recent'
    } catch {
      return 'recent'
    }
  }
  let sort = $state<RepoSort>(loadSort())
  let onlyBusy = $state(false)
  let fetching = $state(false)

  onMount(() => {
    // 뒤쪽 탭은 상태·활동만 읽혀 있으므로 push 대기도 읽는다
    for (const t of app.tabs) if (!t.outgoing && !t.outgoingLoading) void t.refreshOutgoing()
    const timer = setInterval(() => (now = Date.now()), 5000)
    return () => clearInterval(timer)
  })

  $effect(() => {
    try {
      localStorage.setItem('overview:sort', sort)
    } catch {
      // 저장하지 못해도 괜찮다
    }
  })

  const daySec = $derived(Math.floor(now / 1000) - 86400)
  const busy = (r: Repo) => r.changeCount > 0 || r.aheadCount > 0 || r.unseen > 0 || warningCount(r.activity, daySec) > 0
  const repos = $derived(sortRepos(app.tabs, sort).filter((r) => !onlyBusy || busy(r)))
  const feed = $derived(mergeFeed(app.tabs, 80))
  const totals = $derived({
    changes: app.tabs.reduce((n, t) => n + t.changeCount, 0),
    ahead: app.tabs.reduce((n, t) => n + t.aheadCount, 0),
    warn: app.tabs.reduce((n, t) => n + warningCount(t.activity, daySec), 0),
    live: app.tabs.filter((t) => now - t.pulse < 60000).length,
  })

  function open(r: Repo, view?: View) {
    app.select(r.root)
    if (view) r.setView(view)
  }

  async function fetchAll() {
    fetching = true
    await app.fetchAll(false)
    fetching = false
  }

  const stateName: Record<string, string> = { merging: '병합 중', rebasing: 'rebase 중', 'cherry-picking': 'cherry-pick 중', reverting: 'revert 중', bisecting: 'bisect 중' }
</script>

<div class="ov">
  <div class="head">
    <Icon name="grid" size={16} />
    <span class="title">저장소 요약</span>
    <span class="chip">저장소 {app.tabs.length}</span>
    {#if totals.live}<span class="chip live"><span class="pulse"></span>최근 1분 안에 바뀜 {totals.live}</span>{/if}
    {#if totals.changes}<span class="chip warn">변경 {totals.changes}</span>{/if}
    {#if totals.ahead}<span class="chip acc">push 대기 {totals.ahead}</span>{/if}
    {#if totals.warn}<span class="chip err">경고 {totals.warn} (24시간)</span>{/if}
    <span class="grow"></span>
    <label class="chk"><input type="checkbox" bind:checked={onlyBusy} />할 일 있는 저장소만</label>
    <select bind:value={sort} title="정렬">
      <option value="recent">최근 바뀐 순</option>
      <option value="tabs">탭 순서</option>
      <option value="name">이름순</option>
    </select>
    <button class="ghost" disabled={fetching} onclick={fetchAll}><Icon name="fetch" size={14} />{fetching ? '가져오는 중…' : '모두 fetch'}</button>
    <button class="ghost" title="저장소 추가" onclick={() => app.addRepo()}><Icon name="plus" size={14} />추가</button>
    <button class="ghost" title="설정" onclick={() => (app.settingsOpen = true)}><Icon name="gear" size={14} /></button>
  </div>
  <div class="body">
    <div class="cards">
      {#each repos as r (r.root)}
        {@const s = r.status}
        {@const last = lastChange(r)}
        {@const files = recentFiles(s, 3)}
        {@const warn = warningCount(r.activity, daySec)}
        {@const acts = (r.activity ?? []).slice(0, 3)}
        <div class="card" class:live={now - r.pulse < 4000} class:has-warn={warn > 0}>
          <button class="ctitle" onclick={() => open(r)} title="{r.root} — 눌러서 열기">
            <span class="dot" class:on={now - last < 60000}></span>
            <span class="rname">{r.name}</span>
            {#if s}
              <span class="branch"><Icon name="branch" size={12} />{s.branch ?? `분리된 HEAD ${s.head?.slice(0, 7) ?? ''}`}</span>
              {#if s.upstream}<span class="muted small">→ {s.upstream}</span>{/if}
              {#if s.behind}<span class="down" title="원격에만 있는 커밋">↓{s.behind}</span>{/if}
              {#if s.state}<span class="state">{stateName[s.state] ?? s.state}</span>{/if}
            {/if}
          </button>
          <div class="path muted">{r.root}</div>
          {#if r.error}<div class="error">{r.error}</div>{/if}
          <div class="stats">
            <button class="stat" class:warnc={r.changeCount > 0} onclick={() => open(r, 'status')}>
              <b>{r.changeCount}</b><span>변경{#if s?.staged.length} (스테이지 {s.staged.length}){/if}</span>
            </button>
            <button class="stat" class:accc={r.aheadCount > 0} onclick={() => open(r, 'outgoing')}>
              <b>{r.aheadCount}</b><span>push 대기</span>
            </button>
            <button class="stat" class:errc={warn > 0} onclick={() => open(r, 'activity')}>
              <b>{warn}</b><span>경고 (24시간)</span>
            </button>
            <button class="stat" class:errc={r.unseen > 0} onclick={() => open(r, 'activity')}>
              <b>{r.unseen}</b><span>새 활동</span>
            </button>
          </div>
          <div class="last">마지막 변화: <b>{last ? relative(last, now) : '없음'}</b></div>
          {#if files.length}
            <div class="sec">최근 바뀐 파일</div>
            {#each files as f (f.path)}
              <button class="line" title="{f.path} — 파일 상태에서 보기" onclick={() => open(r, 'status')}>
                <span class="st st-{f.status}" title={statusName(f.status)}>{f.status}</span>
                <span class="lt">{basename(f.path)}</span>
                <span class="dim">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
                {#if f.mtime}<span class="when" class:fresh={now - f.mtime < 15000}>{relative(f.mtime, now)}</span>{/if}
              </button>
            {/each}
          {/if}
          {#if acts.length}
            <div class="sec">최근 활동</div>
            {#each acts as e (e.refName + e.time + e.new + e.old)}
              {@const v = describe(e)}
              <button class="line {v.severity}" onclick={() => open(r, 'activity')} title={v.note ?? v.title}>
                <span class="when">{relative(e.time * 1000, now)}</span>
                <span class="kind">{v.label}</span>
                <span class="lt">{v.title}</span>
              </button>
            {/each}
          {/if}
          <div class="actions">
            <button class="ghost" onclick={() => open(r)}><Icon name="history" size={13} />열기</button>
            <button class="ghost" onclick={() => app.fetch(r)}><Icon name="fetch" size={13} />Fetch</button>
            <button class="ghost" onclick={() => app.run(() => app.backend.openTerminal(r.root))}><Icon name="terminal" size={13} />터미널</button>
            <button class="ghost" onclick={() => app.run(() => app.backend.openPath(r.root))}><Icon name="folder" size={13} />탐색기</button>
          </div>
        </div>
      {:else}
        <div class="empty">{onlyBusy ? '할 일이 있는 저장소가 없습니다. 모두 깨끗합니다' : '열린 저장소가 없습니다'}</div>
      {/each}
    </div>
    <aside class="feed">
      <div class="pane-head">
        <Icon name="activity" size={14} />
        <span class="title">전체 활동</span>
        <span class="muted small">모든 저장소 · 최근 것이 위</span>
      </div>
      <div class="flist">
        {#each feed as f (f.root + f.entry.refName + f.entry.time + f.entry.new + f.entry.old)}
          {@const r = app.tabs.find((t) => t.root === f.root)}
          <button class="fitem {f.view.severity}" class:fresh={now - f.entry.time * 1000 < 60000} onclick={() => r && open(r, 'activity')} title={f.view.note ?? ''}>
            <div class="f1">
              <span class="frepo">{f.name}</span>
              <span class="kind">{f.view.label}</span>
              <span class="grow"></span>
              <span class="when" title={shortDate(f.entry.time)}>{relative(f.entry.time * 1000, now)}</span>
            </div>
            <div class="f2">{f.view.ref && !f.view.title.includes(f.view.ref) ? `${f.view.ref} · ` : ''}{f.view.title}</div>
            {#if f.view.note && f.view.severity !== 'normal'}<div class="f3">{f.view.note}</div>{/if}
          </button>
        {:else}
          <div class="empty">기록된 활동이 없습니다</div>
        {/each}
      </div>
    </aside>
  </div>
</div>

<style>
  .ov {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 46px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border-strong);
    background: var(--panel);
    flex: none;
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .title {
    font-weight: 700;
    font-size: 14px;
    margin-right: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--hover);
    font-size: 12px;
    white-space: nowrap;
  }
  .chip.warn {
    background: color-mix(in srgb, var(--warn) 20%, transparent);
    color: var(--warn);
  }
  .chip.acc {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent-text);
  }
  .chip.err {
    background: color-mix(in srgb, var(--err) 20%, transparent);
    color: var(--err);
  }
  .chip.live {
    color: var(--warn);
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  .grow {
    flex: 1;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .small {
    font-size: 11.5px;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .cards {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 14px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    align-content: start;
    gap: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--panel-2);
    min-width: 0;
  }
  .card.live {
    border-color: color-mix(in srgb, var(--warn) 70%, var(--border-strong));
  }
  .card.has-warn {
    border-left: 3px solid var(--err);
  }
  .ctitle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .ctitle:hover .rname {
    text-decoration: underline;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
    flex: none;
  }
  .dot.on {
    background: var(--warn);
    animation: pulse 1s ease-in-out infinite;
  }
  .rname {
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
  }
  .branch {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--hover);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .down {
    color: var(--warn);
    font-weight: 600;
    font-size: 12px;
  }
  .state {
    padding: 0 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--warn) 25%, transparent);
    color: var(--warn);
    font-size: 11.5px;
  }
  .path {
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    color: var(--err);
    font-size: 12px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin-top: 2px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 6px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .stat:hover {
    border-color: var(--accent);
  }
  .stat b {
    font-size: 18px;
    line-height: 1.1;
    color: var(--faint);
  }
  .stat span {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .stat.warnc b {
    color: var(--warn);
  }
  .stat.accc b {
    color: var(--accent-text);
  }
  .stat.errc b {
    color: var(--err);
  }
  .last {
    font-size: 12px;
    color: var(--muted);
  }
  .last b {
    color: var(--text-2);
  }
  .sec {
    margin-top: 4px;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 22px;
    padding: 0 4px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    min-width: 0;
    font-size: 12.5px;
  }
  .line:hover {
    background: var(--hover);
  }
  .lt {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .dim {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .when {
    flex: none;
    color: var(--muted);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .when.fresh {
    color: var(--warn);
    font-weight: 600;
  }
  .line .when {
    min-width: 54px;
  }
  .line .dim + .when {
    min-width: 0;
  }
  .kind {
    flex: none;
    font-weight: 600;
    font-size: 12px;
  }
  .caution .kind {
    color: var(--warn);
  }
  .danger .kind {
    color: var(--err);
  }
  .actions {
    display: flex;
    gap: 2px;
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .feed {
    display: flex;
    flex-direction: column;
    width: 360px;
    flex: none;
    border-left: 1px solid var(--border-strong);
    background: var(--panel);
  }
  .flist {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .fitem {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 7px 12px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .fitem:hover {
    background: var(--hover);
  }
  .fitem.caution {
    border-left-color: var(--warn);
  }
  .fitem.danger {
    border-left-color: var(--err);
    background: color-mix(in srgb, var(--err) 7%, transparent);
  }
  .fitem.fresh .when {
    color: var(--warn);
    font-weight: 600;
  }
  .f1 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .frepo {
    padding: 0 6px;
    border-radius: 4px;
    background: var(--hover-strong);
    font-size: 11.5px;
    font-weight: 600;
  }
  .f2 {
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .f3 {
    font-size: 11.5px;
    color: var(--muted);
  }
  .danger .f3 {
    color: var(--err);
  }
  .caution .f3 {
    color: var(--warn);
  }
  @media (max-width: 1100px) {
    .feed {
      width: 300px;
    }
  }
</style>
