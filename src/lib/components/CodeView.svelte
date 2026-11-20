<script lang="ts" module>
  export interface BlameCell {
    sha: string
    author: string
    time: number
    summary: string
    /** 이 줄이 같은 커밋 묶음의 첫 줄 */
    first: boolean
    /** 0(가장 오래됨) ~ 1(가장 최근) */
    age: number
  }
</script>

<script lang="ts">
  // 파일 내용 보기 (줄 번호, 선택적 blame 칸). 줄 번호를 끌어 범위를 고르면 onrange
  import { shortDate, short } from '../format'

  let {
    lines,
    blame = null,
    range = null,
    onrange,
    onblame,
  }: {
    lines: string[]
    blame?: BlameCell[] | null
    range?: [number, number] | null
    onrange?: (r: [number, number] | null) => void
    onblame?: (sha: string) => void
  } = $props()

  const ROW = 19
  let scrollTop = $state(0)
  let height = $state(400)
  let dragFrom: number | null = null

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 20))
  const end = $derived(Math.min(lines.length, Math.ceil((scrollTop + height) / ROW) + 20))
  const noWidth = $derived(String(lines.length).length * 8 + 18)

  function down(e: PointerEvent, n: number) {
    if (!onrange) return
    e.preventDefault()
    if (e.shiftKey && range) {
      onrange([Math.min(range[0], n), Math.max(range[1], n)])
      return
    }
    dragFrom = n
    onrange([n, n])
  }
  function over(n: number) {
    if (dragFrom == null || !onrange) return
    onrange([Math.min(dragFrom, n), Math.max(dragFrom, n)])
  }
  const up = () => (dragFrom = null)
  /** 아직 커밋하지 않은 줄 (blame이 0000…으로 알려 준다) */
  const uncommitted = (sha: string) => /^0+$/.test(sha)
  const inRange = (n: number) => !!range && n >= range[0] && n <= range[1]
</script>

<svelte:window onpointerup={up} />

<div class="code" bind:clientHeight={height} onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}>
  <div class="rows" style="height:{lines.length * ROW}px">
    <div style="transform:translateY({start * ROW}px)">
      {#each lines.slice(start, end) as text, k (start + k)}
        {@const n = start + k + 1}
        {@const b = blame?.[n - 1]}
        <div class="row" class:in={inRange(n)} class:group={b?.first}>
          {#if blame}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <span class="blame" style="--age:{b?.age ?? 0}" title={b ? `${b.summary}\n${b.author} · ${shortDate(b.time)} · ${short(b.sha)}` : ''} onclick={() => b && onblame?.(b.sha)}>
              {#if b?.first}<span class="bsha mono">{uncommitted(b.sha) ? '커밋 안 됨' : short(b.sha)}</span><span class="bauthor">{b.author}</span><span class="bdate">{shortDate(b.time)}</span>{/if}
            </span>
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="no" style="width:{noWidth}px" onpointerdown={(e) => down(e, n)} onpointerenter={() => over(n)}>{n}</span>
          <span class="tx">{text}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .code {
    height: 100%;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--code-size);
    user-select: text;
  }
  .rows {
    position: relative;
    min-width: max-content;
  }
  .row {
    display: flex;
    height: 19px;
    line-height: 19px;
    white-space: pre;
    tab-size: 4;
  }
  .row.in {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .row.group .blame {
    border-top: 1px solid var(--border-strong);
  }
  .no {
    flex: none;
    padding-right: 8px;
    color: var(--diff-gutter);
    text-align: right;
    cursor: pointer;
    user-select: none;
  }
  .no:hover {
    color: var(--accent-text);
  }
  .tx {
    padding: 0 16px 0 4px;
  }
  .blame {
    display: flex;
    gap: 8px;
    flex: none;
    width: 300px;
    padding: 0 8px;
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--text-2);
    cursor: pointer;
    user-select: none;
    /* 최근 변경일수록 진하게 */
    background: color-mix(in srgb, var(--warn) calc(var(--age) * 22%), var(--panel-2));
    border-right: 1px solid var(--border-strong);
  }
  .blame:hover {
    color: var(--accent-text);
  }
  .bsha {
    flex: none;
    width: 60px;
    color: var(--muted);
  }
  .bauthor {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bdate {
    flex: none;
    color: var(--muted);
  }
</style>
