<script lang="ts">
  // Ctrl+P: 파일을 찾아 바로 이력 조회
  import { errorMessage } from '../api'
  import { basename, dirname } from '../format'
  import { fuzzyFilter } from '../fuzzy'
  import { app, type Repo } from '../state.svelte'
  import Icon from './Icon.svelte'

  let { repo }: { repo: Repo } = $props()

  let all = $state.raw<string[]>([])
  let q = $state('')
  let idx = $state(0)
  let input: HTMLInputElement | undefined = $state()

  const shown = $derived(fuzzyFilter(q, all, 60))

  $effect(() => {
    app.backend
      .files(repo.root)
      .then((f) => (all = f))
      .catch((e) => app.toast(errorMessage(e), 'error'))
    input?.focus()
  })

  $effect(() => {
    void q
    idx = 0
  })

  function choose(p: string | undefined, tab: 'diff' | 'blame' = 'diff') {
    if (!p) return
    app.quickOpen = false
    repo.openFileHistory({ path: p, tab })
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') app.quickOpen = false
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      idx = Math.min(shown.length - 1, idx + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      idx = Math.max(0, idx - 1)
    } else if (e.key === 'Enter') choose(shown[idx], e.shiftKey ? 'blame' : 'diff')
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={() => (app.quickOpen = false)}></div>
<div class="qo" role="dialog" aria-label="파일 찾기">
  <div class="in">
    <Icon name="search" size={15} />
    <input bind:this={input} bind:value={q} onkeydown={onkey} placeholder="이력을 볼 파일 (Enter: 이력, Shift+Enter: Blame)" />
  </div>
  <div class="list">
    {#each shown as p, i (p)}
      <button class="row" class:sel={i === idx} onmouseenter={() => (idx = i)} onclick={() => choose(p)}>
        <Icon name="file" size={14} />
        <span class="name">{basename(p)}</span>
        <span class="dir">{dirname(p)}</span>
      </button>
    {:else}
      <div class="none muted">{all.length ? '맞는 파일이 없습니다' : '파일 목록을 읽는 중…'}</div>
    {/each}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(0 0 0 / 0.25);
  }
  .qo {
    position: fixed;
    top: 90px;
    left: 50%;
    z-index: 81;
    width: min(640px, 92vw);
    transform: translateX(-50%);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.4);
    overflow: hidden;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
  }
  .in input {
    flex: 1;
    border: 0;
    outline: none;
    background: none;
    color: var(--text);
    font-size: 14px;
  }
  .list {
    max-height: 420px;
    overflow: auto;
    padding: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .row.sel {
    background: var(--sel);
  }
  .dir {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12px;
  }
  .none {
    padding: 12px;
  }
</style>
