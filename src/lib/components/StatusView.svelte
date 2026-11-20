<script lang="ts">
  // 파일 상태 (작업 트리): 스테이지된 / 스테이지 안 된 파일과 diff. 실시간으로 갱신된다
  import { errorMessage } from '../api'
  import { fileMenu } from '../menus'
  import { app, type Repo } from '../state.svelte'
  import type { DiffTarget, TextBlob, WorkFile } from '../types'
  import DiffView from './DiffView.svelte'
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

  const current = $derived.by(() => {
    if (!pick) return null
    const list = pick.group === 'staged' ? staged : pick.group === 'unstaged' ? unstaged : conflicted
    return list.find((f) => f.path === pick!.path) ?? null
  })

  // 처음엔 가장 최근에 바뀐 파일을 고른다. 고른 파일이 사라지면 다시 고른다
  $effect(() => {
    if (current) return
    const first = unstaged[0] ? { group: 'unstaged' as Group, path: unstaged[0].path } : staged[0] ? { group: 'staged' as Group, path: staged[0].path } : null
    pick = first
  })

  // 파일이 바뀌면(mtime) diff를 다시 읽는다
  const diffKey = $derived(current && pick ? `${pick.group}:${current.path}:${current.mtime}:${current.status}:${repo.status?.head}:${app.settings.ignoreWhitespace}` : '')
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

  const menu = (e: MouseEvent, f: { path: string; status: string }) => app.openMenu(e, fileMenu(repo, { path: f.path, deleted: f.status === 'D' }))
</script>

<Split key="status" initial={0.36} min={240}>
  {#snippet a()}
    <div class="lists">
      <div class="pane-head">
        <span class="title">파일 상태</span>
        {#if repo.status?.state}<span class="state">{repo.status.state === 'merging' ? '병합 중' : repo.status.state === 'rebasing' ? 'rebase 중' : repo.status.state}</span>{/if}
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
      <div class="scroll">
        {#if conflicted.length}
          <div class="group warn"><Icon name="warning" size={13} />충돌 ({conflicted.length})</div>
          <FileList files={conflicted} {tree} showTime {now} selected={pick?.group === 'conflicted' ? pick.path : null} onselect={(f) => (pick = { group: 'conflicted', path: f.path })} oncontext={menu} />
        {/if}
        <div class="group">스테이지된 파일 ({staged.length})</div>
        {#if staged.length}
          <FileList files={staged} {tree} showTime {now} selected={pick?.group === 'staged' ? pick.path : null} onselect={(f) => (pick = { group: 'staged', path: f.path })} oncontext={menu} ondblclick={(f) => repo.openFileHistory({ path: f.path })} />
        {:else}
          <div class="none">없음</div>
        {/if}
        <div class="group">스테이지 안 된 파일 ({unstaged.length})</div>
        {#if unstaged.length}
          <FileList files={unstaged} {tree} showTime {now} selected={pick?.group === 'unstaged' ? pick.path : null} onselect={(f) => (pick = { group: 'unstaged', path: f.path })} oncontext={menu} ondblclick={(f) => repo.openFileHistory({ path: f.path })} />
        {:else}
          <div class="none">없음</div>
        {/if}
        {#if repo.status?.truncated}<div class="none warn">파일이 너무 많아 일부만 보여 줍니다</div>{/if}
      </div>
      <div class="foot muted">
        <Icon name="eye" size={13} />
        AI가 파일을 바꾸면 바로 반영됩니다. 커밋·스테이지는 AI에게 맡기세요.
      </div>
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
      <DiffView {blob} {loading} {error} title={current ? `${pick?.group === 'staged' ? '스테이지됨 · ' : ''}${current.path}` : ''} />
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
  .none {
    padding: 6px 12px;
    color: var(--faint);
    font-size: 12px;
  }
  .state {
    padding: 0 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--warn) 25%, transparent);
    color: var(--warn);
    font-size: 11.5px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
  }
  .clean .big {
    display: grid;
    place-items: center;
    margin-bottom: 8px;
    color: var(--ok);
  }
</style>
