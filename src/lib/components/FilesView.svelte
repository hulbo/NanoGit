<script lang="ts">
  // 파일 탐색: 추적 중인 모든 파일. 고르면 내용, 더블클릭·Enter는 이력 조회
  import { errorMessage } from '../api'
  import { basename, dirname } from '../format'
  import { fuzzyFilter } from '../fuzzy'
  import { fileMenu } from '../menus'
  import { app, type Repo } from '../state.svelte'
  import type { TextBlob } from '../types'
  import CodeView from './CodeView.svelte'
  import Icon from './Icon.svelte'
  import Split from './Split.svelte'

  let { repo }: { repo: Repo } = $props()

  const ROW = 24
  let all = $state.raw<string[]>([])
  let loading = $state(false)
  let query = $state('')
  let selected = $state<string | null>(null)
  let content = $state<TextBlob | null>(null)
  let error = $state<string | null>(null)
  let scrollTop = $state(0)
  let height = $state(400)
  let scroller: HTMLDivElement | undefined = $state()

  const shown = $derived(fuzzyFilter(query, all, 5000))
  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 10))
  const end = $derived(Math.min(shown.length, Math.ceil((scrollTop + height) / ROW) + 10))
  const lines = $derived(content && !content.binary ? content.text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [])

  async function load() {
    loading = true
    try {
      all = await app.backend.files(repo.root)
    } catch (e) {
      app.toast(errorMessage(e), 'error')
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void repo.root
    void load()
  })

  $effect(() => {
    const p = selected
    content = null
    error = null
    if (!p) return
    app.backend
      .fileContent(repo.root, p, null)
      .then((b) => {
        if (selected === p) content = b
      })
      .catch((e) => {
        if (selected === p) error = errorMessage(e)
      })
  })

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Enter' && selected) {
      repo.openFileHistory({ path: selected })
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = selected ? shown.indexOf(selected) : -1
    const next = Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    selected = shown[next] ?? null
    if (scroller) {
      const top = next * ROW
      if (top < scroller.scrollTop) scroller.scrollTop = top
      else if (top + ROW > scroller.scrollTop + height) scroller.scrollTop = top + ROW - height
    }
  }
</script>

<Split key="files" initial={0.36} min={240}>
  {#snippet a()}
    <div class="left">
      <div class="pane-head">
        <Icon name="files" size={15} />
        <span class="title">파일 탐색</span>
        <span class="muted small">{loading ? '읽는 중…' : `${all.length.toLocaleString()}개`}</span>
        <span class="grow"></span>
        <button class="ghost" title="다시 읽기" onclick={load}><Icon name="refresh" size={14} /></button>
      </div>
      <div class="q">
        <!-- svelte-ignore a11y_autofocus -->
        <input type="search" placeholder="파일 이름으로 찾기 (글자 순서대로, *·?로 패턴)" bind:value={query} onkeydown={onkey} autofocus />
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="list" bind:this={scroller} bind:clientHeight={height} onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)} tabindex="0" onkeydown={onkey} role="listbox">
        <div style="height:{shown.length * ROW}px; position:relative">
          <div style="transform:translateY({start * ROW}px)">
            {#each shown.slice(start, end) as p (p)}
              <button
                class="row"
                class:sel={selected === p}
                onclick={() => (selected = p)}
                ondblclick={() => repo.openFileHistory({ path: p })}
                oncontextmenu={(e) => {
                  selected = p
                  app.openMenu(e, fileMenu(repo, { path: p }))
                }}
              >
                <Icon name="file" size={14} />
                <span class="name">{basename(p)}</span>
                <span class="dir">{dirname(p)}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/snippet}
  {#snippet b()}
    <div class="right">
      <div class="pane-head">
        <span class="title mono">{selected ?? ''}</span>
        <span class="grow"></span>
        {#if selected}
          <button class="ghost" onclick={() => repo.openFileHistory({ path: selected! })}><Icon name="history" size={14} />이력 조회</button>
          <button class="ghost" onclick={() => repo.openFileHistory({ path: selected!, tab: 'blame' })}><Icon name="blame" size={14} />Blame</button>
        {/if}
      </div>
      <div class="view">
        {#if error}
          <div class="empty err">{error}</div>
        {:else if !selected}
          <div class="empty">파일을 고르세요. 더블클릭하면 이력을 봅니다</div>
        {:else if content?.binary}
          <div class="empty">이진 파일입니다</div>
        {:else if content}
          <CodeView {lines} path={selected} />
        {/if}
      </div>
    </div>
  {/snippet}
</Split>

<style>
  .left,
  .right {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .small {
    font-size: 12px;
  }
  .q {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .q input {
    width: 100%;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 24px;
    padding: 0 10px;
    border: 0;
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
  .name {
    white-space: nowrap;
  }
  .dir {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12px;
  }
  .view {
    flex: 1;
    min-height: 0;
  }
  .err {
    color: var(--err);
  }
</style>
