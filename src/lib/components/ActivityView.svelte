<script lang="ts">
  // 활동: AI가 한 git 작업 타임라인 (reflog). 고른 항목의 커밋을 아래에 보여 준다
  import { groupActivity, matchesFilter, type ActivityFilter, type ActivityItem } from '../activity'
  import { dateTime, relative, short } from '../format'
  import { commitMenu } from '../menus'
  import { app, type Repo } from '../state.svelte'
  import CommitPanel from './CommitPanel.svelte'
  import Icon from './Icon.svelte'
  import type { IconName } from './Icon.svelte'
  import Split from './Split.svelte'

  let { repo }: { repo: Repo } = $props()

  let filter = $state<ActivityFilter>('all')
  let picked = $state<ActivityItem | null>(null)
  let showDropped = $state(false)
  let now = $state(Date.now())

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 10000)
    return () => clearInterval(t)
  })

  const items = $derived(groupActivity(repo.activity ?? []).filter((i) => matchesFilter(i.view, filter)))
  const warnCount = $derived(groupActivity(repo.activity ?? []).filter((i) => i.view.severity !== 'normal').length)

  const ICONS: Record<string, IconName> = {
    commit: 'commit',
    initial: 'commit',
    amend: 'editor',
    'merge-commit': 'branch',
    checkout: 'branch',
    reset: 'warning',
    merge: 'branch',
    pull: 'fetch',
    rebase: 'history',
    'cherry-pick': 'commit',
    revert: 'back',
    push: 'push',
    fetch: 'fetch',
    branch: 'branch',
    rename: 'editor',
    stash: 'stash',
    clone: 'cloud',
    other: 'more',
  }

  /** 아래 패널에 보여 줄 커밋: 버려진 커밋 보기면 이전 위치 */
  const sha = $derived.by(() => {
    if (!picked) return null
    const e = picked.entry
    if (showDropped && !/^0+$/.test(e.old)) return e.old
    return /^0+$/.test(e.new) ? null : e.new
  })

  function pick(i: ActivityItem, dropped = false) {
    picked = i
    showDropped = dropped
  }

  const FILTERS: [ActivityFilter, string][] = [
    ['all', '전체'],
    ['commit', '커밋'],
    ['branch', '브랜치'],
    ['remote', '원격'],
    ['warn', '경고'],
  ]
</script>

<Split dir="v" key="activity" initial={0.5} min={140}>
  {#snippet a()}
    <div class="top">
      <div class="pane-head">
        <Icon name="activity" size={15} />
        <span class="title">활동</span>
        <span class="muted small">git reflog 기준 · 최근 것이 위</span>
        <span class="grow"></span>
        <div class="seg">
          {#each FILTERS as [f, label] (f)}
            <button class:on={filter === f} onclick={() => (filter = f)}>{label}{#if f === 'warn' && warnCount}<span class="wc">{warnCount}</span>{/if}</button>
          {/each}
        </div>
        <button class="ghost" title="다시 읽기" onclick={() => repo.refreshActivity(false)}><Icon name="refresh" size={14} /></button>
      </div>
      <div class="list">
        {#each items as i (i.entry.refName + i.entry.time + i.entry.new + i.entry.old)}
          {@const v = i.view}
          {@const e = i.entry}
          <button
            class="row {v.severity}"
            class:sel={picked?.entry === e}
            class:fresh={now - e.time * 1000 < 60000}
            onclick={() => pick(i)}
            oncontextmenu={(ev) => {
              pick(i)
              if (!/^0+$/.test(e.new)) app.openMenu(ev, commitMenu(repo, e.new, e.subject ?? ''))
            }}
          >
            <span class="time" title={dateTime(e.time, true)}>{relative(e.time * 1000, now)}</span>
            <span class="kind"><Icon name={ICONS[v.kind] ?? 'more'} size={14} />{v.label}{i.steps > 1 ? ` ×${i.steps}` : ''}</span>
            <span class="ref">{v.ref ?? (e.refName === 'HEAD' ? 'HEAD' : '')}</span>
            <span class="what">
              <span class="title-text">{v.title}</span>
              {#if v.note}<span class="note">{v.note}</span>{/if}
              {#if e.dropped > 0}
                <span
                  class="drop"
                  role="button"
                  tabindex="-1"
                  onclick={(ev) => {
                    ev.stopPropagation()
                    pick(i, true)
                  }}
                  onkeydown={() => {}}>버려진 쪽 보기 ({short(e.old)})</span
                >
              {/if}
            </span>
            <span class="who">{e.who}</span>
          </button>
        {:else}
          <div class="empty">{repo.activity ? '기록된 활동이 없습니다' : '불러오는 중…'}</div>
        {/each}
      </div>
    </div>
  {/snippet}
  {#snippet b()}
    {#if picked && !picked.view.showsCommit && !showDropped}
      <div class="empty">
        <div>
          <b>{picked.view.label}</b> · {picked.view.title}<br />
          <span class="muted">{dateTime(picked.entry.time, true)} · {short(picked.entry.old)} → {short(picked.entry.new)}</span><br /><br />
          <button class="ghost on" onclick={() => repo.reveal(picked!.entry.new)}><Icon name="history" size={14} />히스토리에서 보기</button>
        </div>
      </div>
    {:else}
      {#if showDropped && picked}
        <div class="banner">버려진 쪽(이전 위치) {short(picked.entry.old)}을(를) 보는 중입니다. 이 커밋은 아직 reflog에 남아 있습니다.</div>
      {/if}
      <div class="panel" class:with-banner={showDropped}>
        <CommitPanel {repo} {sha} key="activity" />
      </div>
    {/if}
  {/snippet}
</Split>

<style>
  .top {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .small {
    font-size: 12px;
  }
  .wc {
    margin-left: 4px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--err);
    color: #fff;
    font-size: 10.5px;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .row {
    display: grid;
    grid-template-columns: 78px 120px 140px 1fr 110px;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 3px 10px;
    border: 0;
    border-left: 3px solid transparent;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: default;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.sel {
    background: var(--sel);
  }
  .row.caution {
    border-left-color: var(--warn);
  }
  .row.danger {
    border-left-color: var(--err);
    background: color-mix(in srgb, var(--err) 8%, transparent);
  }
  .row.danger.sel {
    background: color-mix(in srgb, var(--err) 18%, var(--sel));
  }
  .row.fresh .time {
    color: var(--warn);
    font-weight: 600;
  }
  .time {
    color: var(--muted);
    font-size: 12px;
  }
  .kind {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    white-space: nowrap;
  }
  .danger .kind {
    color: var(--err);
  }
  .caution .kind {
    color: var(--warn);
  }
  .ref {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent-text);
    font-size: 12px;
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
    min-width: 0;
  }
  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .note {
    color: var(--muted);
    font-size: 12px;
  }
  .danger .note {
    color: var(--err);
  }
  .caution .note {
    color: var(--warn);
  }
  .drop {
    color: var(--accent-text);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
  }
  .who {
    color: var(--muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .banner {
    height: 28px;
    padding: 5px 12px;
    background: color-mix(in srgb, var(--err) 14%, transparent);
    color: var(--err);
    font-size: 12px;
  }
  .panel {
    height: 100%;
  }
  .panel.with-banner {
    height: calc(100% - 28px);
  }
</style>
