<script lang="ts">
  // 왼쪽 사이드바 (소스트리 구성): 작업 공간, 브랜치, 태그, 원격, Stash
  import * as act from '../actions'
  import { relative, short } from '../format'
  import { branchMenu as branchOps, commitMenu, remoteBranchMenu, stashMenu, tagMenu } from '../menus'
  import { app, type Repo, type View } from '../state.svelte'
  import Icon, { type IconName } from './Icon.svelte'

  let { repo }: { repo: Repo } = $props()

  const load = (): Record<string, boolean> => {
    try {
      return JSON.parse(localStorage.getItem('sidebar:open') ?? '{}')
    } catch {
      return {}
    }
  }
  let open = $state<Record<string, boolean>>({ workspace: true, branches: true, tags: false, remotes: true, stashes: false, ...load() })
  let remoteOpen = $state<Record<string, boolean>>({})

  function toggle(k: string) {
    open[k] = !open[k]
    try {
      localStorage.setItem('sidebar:open', JSON.stringify(open))
    } catch {
      // 저장하지 못해도 괜찮다
    }
  }

  const refs = $derived(repo.refs)
  const warn = $derived((repo.activity ?? []).slice(0, 50).some((e) => e.dropped > 0))

  const items: [View, string, IconName][] = [
    ['status', '파일 상태', 'status'],
    ['history', '히스토리', 'history'],
    ['activity', '활동', 'activity'],
    ['outgoing', 'Push 대기', 'push'],
    ['files', '파일 탐색', 'files'],
  ]

  type MenuEntries = ReturnType<typeof commitMenu>

  /** 브랜치·태그 우클릭: 조작(ops)이 있으면 커밋 조작은 빼고 보기·복사만 덧붙인다 */
  function branchMenu(e: MouseEvent, name: string, sha: string, subject: string, ops: MenuEntries = []) {
    const view: MenuEntries = ops.length
      ? [
          { label: '히스토리에서 보기', icon: 'history', action: () => repo.reveal(sha) },
          { label: '커밋 해시 복사', icon: 'copy', action: () => app.copy(sha, '해시') },
        ]
      : commitMenu(repo, sha, subject)
    app.openMenu(e, [...ops, { label: '이것만 히스토리 보기', icon: 'history', action: () => showOnly(name) }, ...view, { label: '이름 복사', action: () => app.copy(name, '이름') }])
  }

  async function showOnly(rev: string) {
    repo.setView('history')
    repo.selected = null
    repo.search = ''
    try {
      repo.commits = await app.backend.log(repo.root, { scope: { kind: 'revs', revs: [rev] }, skip: 0, limit: 1000 })
      repo.logDone = true
      repo.selected = repo.commits[0]?.sha ?? null
      app.toast(`${rev} 브랜치만 보는 중입니다. "모든 브랜치"를 누르면 돌아갑니다`, 'info')
    } catch (e) {
      app.toast(String(e), 'error')
    }
  }
</script>

<nav class="side">
  <button class="sec" onclick={() => toggle('workspace')}><Icon name={open.workspace ? 'chevron-down' : 'chevron-right'} size={12} />작업 공간</button>
  {#if open.workspace}
    {#each items as [v, label, icon] (v)}
      <button class="item" class:sel={repo.view === v} onclick={() => repo.setView(v)}>
        <Icon name={icon} size={15} />
        <span class="label">{label}</span>
        {#if v === 'status' && repo.changeCount}<span class="count warn">{repo.changeCount}</span>{/if}
        {#if v === 'activity' && warn}<span class="warn-ic" title="최근 위험한 작업이 있습니다"><Icon name="warning" size={13} /></span>{/if}
        {#if v === 'activity' && repo.unseen}<span class="count err">{repo.unseen}</span>{/if}
        {#if v === 'outgoing' && repo.aheadCount}<span class="count">↑{repo.aheadCount}</span>{/if}
      </button>
    {/each}
    {#if repo.view === 'fileHistory' && repo.fileHistory}
      <button class="item sel"><Icon name="history" size={15} /><span class="label">이력: {repo.fileHistory.path.split('/').pop()}</span></button>
    {/if}
  {/if}

  <button class="sec" onclick={() => toggle('branches')}>
    <Icon name={open.branches ? 'chevron-down' : 'chevron-right'} size={12} />브랜치<span class="sec-n">{refs?.branches.length ?? ''}</span>
  </button>
  {#if open.branches && refs}
    {#each refs.branches as b (b.name)}
      <button
        class="item ref-item"
        class:current={b.current}
        title="{b.name}{b.upstream ? ` → ${b.upstream}` : ' (추적 브랜치 없음)'}{b.gone ? ' · 원격에서 지워짐' : ''}\n{b.subject}\n{relative(b.time * 1000)}"
        onclick={() => repo.reveal(b.sha)}
        ondblclick={() => app.canWrite && !b.current && act.switchBranch(repo, b.name)}
        oncontextmenu={(e) => branchMenu(e, b.name, b.sha, b.subject, branchOps(repo, b))}
      >
        <span class="bullet">{b.current ? '●' : ''}</span>
        <span class="label">{b.name}</span>
        {#if b.ahead}<span class="ab up" title="push 대기">↑{b.ahead}</span>{/if}
        {#if b.behind}<span class="ab down" title="원격에만 있는 커밋">↓{b.behind}</span>{/if}
        {#if b.gone}<span class="ab gone" title="추적하던 원격 브랜치가 사라짐">✕</span>{/if}
        {#if !b.upstream}<span class="ab local" title="원격에 올라가지 않은 브랜치">로컬</span>{/if}
      </button>
    {/each}
  {/if}

  <button class="sec" onclick={() => toggle('tags')}>
    <Icon name={open.tags ? 'chevron-down' : 'chevron-right'} size={12} />태그<span class="sec-n">{refs?.tags.length ?? ''}</span>
  </button>
  {#if open.tags && refs}
    {#each refs.tags.slice(0, 200) as t (t.name)}
      <button class="item ref-item" onclick={() => repo.reveal(t.sha)} oncontextmenu={(e) => branchMenu(e, t.name, t.sha, t.name, tagMenu(repo, t.name))}>
        <Icon name="tag" size={13} /><span class="label">{t.name}</span>
      </button>
    {/each}
  {/if}

  <button class="sec" onclick={() => toggle('remotes')}>
    <Icon name={open.remotes ? 'chevron-down' : 'chevron-right'} size={12} />원격<span class="sec-n">{refs?.remotes.length ?? ''}</span>
  </button>
  {#if open.remotes && refs}
    {#each refs.remotes as r (r.name)}
      <button class="item" title={r.url ?? ''} onclick={() => (remoteOpen[r.name] = !remoteOpen[r.name])}>
        <Icon name={remoteOpen[r.name] ? 'chevron-down' : 'chevron-right'} size={12} />
        <Icon name="cloud" size={14} />
        <span class="label">{r.name}</span>
        <span class="count muted">{r.branches.length}</span>
      </button>
      {#if remoteOpen[r.name]}
        {#each r.branches as rb (rb.name)}
          <button
            class="item ref-item deep"
            onclick={() => repo.reveal(rb.sha)}
            ondblclick={() => app.canWrite && act.switchRemote(repo, rb.name)}
            oncontextmenu={(e) => branchMenu(e, rb.name, rb.sha, rb.name, remoteBranchMenu(repo, rb.name))}
            title="{rb.name} · {relative(rb.time * 1000)}"
          >
            <span class="label">{rb.name.slice(r.name.length + 1)}</span>
            <span class="time">{relative(rb.time * 1000)}</span>
          </button>
        {/each}
      {/if}
    {/each}
  {/if}

  <button class="sec" onclick={() => toggle('stashes')}>
    <Icon name={open.stashes ? 'chevron-down' : 'chevron-right'} size={12} />Stash<span class="sec-n">{refs?.stashes.length || ''}</span>
  </button>
  {#if open.stashes && refs}
    {#each refs.stashes as s (s.index)}
      <button class="item ref-item" title="{s.message}\n{relative(s.time * 1000)}" onclick={() => repo.reveal(s.sha)} oncontextmenu={(e) =>
          app.openMenu(e, [
            ...stashMenu(repo, s.index, s.message),
            { label: '히스토리에서 보기', icon: 'history', action: () => repo.reveal(s.sha) },
            { label: '메시지 복사', icon: 'copy', action: () => app.copy(s.message, '메시지') },
          ])}>
        <Icon name="stash" size={13} /><span class="label">{s.message}</span><span class="time mono">{short(s.sha)}</span>
      </button>
    {:else}
      <div class="none">없음</div>
    {/each}
  {/if}
</nav>

<style>
  .side {
    height: 100%;
    overflow: auto;
    padding: 4px 0 12px;
    background: var(--panel);
  }
  .sec {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 26px;
    margin-top: 6px;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  .sec-n {
    margin-left: auto;
    font-weight: 400;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 26px;
    padding: 0 10px 0 20px;
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: default;
  }
  .item:hover {
    background: var(--hover);
  }
  .item.sel {
    background: var(--sel);
  }
  .item.deep {
    padding-left: 48px;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ref-item {
    font-size: 12.5px;
  }
  .current .label {
    font-weight: 700;
  }
  .bullet {
    width: 10px;
    color: var(--accent-text);
    font-size: 10px;
    flex: none;
  }
  .count {
    padding: 0 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent-text);
    font-size: 11px;
    font-weight: 700;
  }
  .count.warn {
    background: color-mix(in srgb, var(--warn) 25%, transparent);
    color: var(--warn);
  }
  .count.err {
    background: var(--err);
    color: #fff;
  }
  .count.muted {
    background: none;
    color: var(--muted);
    font-weight: 400;
  }
  .warn-ic {
    color: var(--err);
  }
  .ab {
    font-size: 11px;
    font-weight: 600;
  }
  .up {
    color: var(--accent-text);
  }
  .down {
    color: var(--warn);
  }
  .gone {
    color: var(--err);
  }
  .local {
    color: var(--muted);
    font-weight: 400;
  }
  .time {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .none {
    padding: 2px 20px;
    color: var(--faint);
    font-size: 12px;
  }
</style>
