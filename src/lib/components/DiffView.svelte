<script lang="ts" module>
  import type { IconName } from './Icon.svelte'

  export interface HunkAction {
    label: string
    icon?: IconName
    danger?: boolean
    run: (header: string) => void
  }
</script>

<script lang="ts">
  // diff 보기 (통합 / 나란히). 화면에 보이는 줄만 그린다.
  import type { Snippet } from 'svelte'
  import { diffStats, parseDiff, splitRows, unifiedRows } from '../diff'
  import { highlightDiff } from '../highlight'
  import { app } from '../state.svelte'
  import type { TextBlob } from '../types'
  import CodeText from './CodeText.svelte'
  import Icon from './Icon.svelte'

  let {
    blob,
    loading = false,
    error = null,
    title = '',
    emptyText = '파일을 고르면 변경 내용이 보입니다',
    fileHeaders = false,
    actions,
    hunkActions = [],
  }: {
    blob: TextBlob | null
    loading?: boolean
    error?: string | null
    title?: string
    emptyText?: string
    fileHeaders?: boolean
    actions?: Snippet
    /** 헝크마다 붙는 버튼 (스테이지·언스테이지·버리기). 공백 무시 중에는 숨긴다 */
    hunkActions?: HunkAction[]
  } = $props()

  const hacts = $derived(app.settings.ignoreWhitespace ? [] : hunkActions)

  const ROW = 19
  const files = $derived.by(() => {
    if (!blob || blob.binary) return []
    const f = parseDiff(blob.text)
    highlightDiff(f)
    return f
  })
  const stats = $derived(diffStats(files))
  const mode = $derived(app.settings.diffMode)
  const uRows = $derived(mode === 'unified' ? unifiedRows(files, fileHeaders || files.length > 1) : [])
  const sRows = $derived(mode === 'split' ? splitRows(files) : [])
  const count = $derived(mode === 'unified' ? uRows.length : sRows.length)
  const binaryInDiff = $derived(files.length > 0 && files.every((f) => f.binary))

  let scroller: HTMLDivElement | undefined = $state()
  let scrollTop = $state(0)
  let height = $state(400)

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 20))
  const end = $derived(Math.min(count, Math.ceil((scrollTop + height) / ROW) + 20))

  $effect(() => {
    // 내용이 바뀌면 맨 위로
    void blob
    if (scroller) scroller.scrollTop = 0
    scrollTop = 0
  })

  function setMode(m: 'unified' | 'split') {
    app.settings.diffMode = m
    void app.persist()
  }

  function toggleWs() {
    app.settings.ignoreWhitespace = !app.settings.ignoreWhitespace
    void app.persist()
  }
</script>

{#snippet hunkButtons(header: string)}
  {#each hacts as a (a.label)}
    <button class="hbtn" class:danger={a.danger} onclick={() => a.run(header)}>{#if a.icon}<Icon name={a.icon} size={11} />{/if}{a.label}</button>
  {/each}
{/snippet}

<div class="diff">
  <div class="pane-head">
    <span class="title mono" title={title}>{title}</span>
    {#if blob && !blob.binary && files.length}
      <span class="stats mono"><span class="add-n">+{stats.additions}</span> <span class="del-n">-{stats.deletions}</span></span>
    {/if}
    {#if blob?.encoding === 'cp949'}<span class="badge" title="UTF-8이 아니어서 CP949로 읽었습니다">CP949</span>{/if}
    <span class="grow"></span>
    {@render actions?.()}
    <button class="ghost" class:on={app.settings.ignoreWhitespace} title="공백 변경 무시" onclick={toggleWs}>공백 무시</button>
    <div class="seg">
      <button class:on={mode === 'unified'} onclick={() => setMode('unified')}>통합</button>
      <button class:on={mode === 'split'} onclick={() => setMode('split')}>나란히</button>
    </div>
  </div>
  <div
    class="body"
    bind:this={scroller}
    bind:clientHeight={height}
    onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
  >
    {#if error}
      <div class="empty err">{error}</div>
    {:else if loading && !blob}
      <div class="empty">불러오는 중…</div>
    {:else if !blob}
      <div class="empty">{emptyText}</div>
    {:else if blob.binary || binaryInDiff}
      <div class="empty">이진 파일입니다 ({blob.size.toLocaleString()} 바이트)</div>
    {:else if count === 0}
      <div class="empty">{blob.text.trim() ? '내용 차이 없음 (모드·이름만 바뀜)' : '변경 없음'}</div>
    {:else}
      <div class="rows" class:split={mode === 'split'} style="height:{count * ROW}px">
        <div style="transform: translateY({start * ROW}px)">
          {#if mode === 'unified'}
            {#each uRows.slice(start, end) as r, i (start + i)}
              {#if r.kind === 'file'}
                <div class="row file">{r.text}</div>
              {:else if r.kind === 'hunk'}
                <div class="row hunk"><span class="no"></span><span class="no"></span><span class="tx">{r.text}</span>{@render hunkButtons(r.text)}</div>
              {:else}
                <div class="row {r.kind}">
                  <span class="no">{r.old ?? ''}</span><span class="no">{r.new ?? ''}</span><span class="sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ''}</span><span class="tx"><CodeText text={r.text} toks={r.toks} mark={r.mark} /></span>
                </div>
              {/if}
            {/each}
          {:else}
            {#each sRows.slice(start, end) as r, i (start + i)}
              {#if r.hunk}
                <div class="row hunk"><span class="tx">{r.hunk}</span>{@render hunkButtons(r.hunk)}</div>
              {:else}
                <div class="row pair">
                  <div class="half {r.left?.kind ?? 'none'}"><span class="no">{r.left?.no ?? ''}</span><span class="tx">{#if r.left}<CodeText text={r.left.text} toks={r.left.toks} mark={r.left.mark} />{/if}</span></div>
                  <div class="half {r.right?.kind ?? 'none'}"><span class="no">{r.right?.no ?? ''}</span><span class="tx">{#if r.right}<CodeText text={r.right.text} toks={r.right.toks} mark={r.right.mark} />{/if}</span></div>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </div>
      {#if blob.truncated}<div class="trunc">너무 커서 앞부분만 보여 줍니다</div>{/if}
    {/if}
  </div>
</div>

<style>
  .diff {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }
  .stats {
    font-size: 12px;
  }
  .badge {
    padding: 0 5px;
    border: 1px solid var(--warn);
    border-radius: 4px;
    color: var(--warn);
    font-size: 10.5px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--code-size);
    user-select: text;
  }
  .empty.err {
    color: var(--err);
    white-space: pre-wrap;
    user-select: text;
  }
  .rows {
    position: relative;
    min-width: max-content;
  }
  .rows.split {
    min-width: 0;
  }
  .row {
    display: flex;
    height: 19px;
    line-height: 19px;
    white-space: pre;
    tab-size: 4;
  }
  .no {
    flex: none;
    width: 44px;
    padding-right: 6px;
    color: var(--diff-gutter);
    text-align: right;
    user-select: none;
  }
  .sign {
    flex: none;
    width: 14px;
    color: var(--diff-gutter);
    user-select: none;
  }
  .tx {
    padding-right: 16px;
  }
  .add {
    background: var(--diff-add-bg);
  }
  .del {
    background: var(--diff-del-bg);
  }
  .add :global(mark) {
    background: var(--diff-add-mark);
    color: inherit;
  }
  .del :global(mark) {
    background: var(--diff-del-mark);
    color: inherit;
  }
  .nonl .tx {
    color: var(--muted);
    font-style: italic;
  }
  .hunk {
    background: var(--diff-hunk-bg);
    color: var(--diff-hunk-fg);
  }
  .hunk .tx {
    padding-left: 8px;
  }
  .hbtn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 16px;
    margin: 1px 4px 0 0;
    padding: 0 6px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text-2);
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 14px;
    cursor: pointer;
  }
  .hbtn:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .hbtn.danger:hover {
    border-color: var(--err);
    color: var(--err);
  }
  .file {
    padding-left: 8px;
    background: var(--panel-2);
    font-weight: 600;
    border-top: 1px solid var(--border-strong);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .half {
    display: flex;
    overflow: hidden;
    min-width: 0;
  }
  .half + .half {
    border-left: 1px solid var(--border-strong);
  }
  .half.none {
    background: repeating-linear-gradient(-45deg, transparent 0 4px, color-mix(in srgb, var(--border-strong) 35%, transparent) 4px 5px);
  }
  .trunc {
    padding: 8px 12px;
    color: var(--warn);
    font-family: var(--font-ui);
  }
</style>
