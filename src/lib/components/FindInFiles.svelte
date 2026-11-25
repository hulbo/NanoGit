<script lang="ts" module>
  import type { GrepQuery } from '../types'
  // 마지막 검색 (다시 열면 그대로. 인텔리제이처럼)
  const last = $state<GrepQuery>({ text: '', caseSensitive: false, wholeWord: false, regex: false, mask: '' })
</script>

<script lang="ts">
  // Ctrl+H (인텔리제이 Find in Files): 작업 트리 파일 내용에서 찾는다 (git grep, 무시한 파일·이진 파일 빼고).
  // Enter·더블클릭이면 그 파일의 이력(Ctrl+Shift+R과 같은 화면)을 열고 맞은 줄로 간다
  import { onMount } from 'svelte'
  import { errorMessage } from '../api'
  import { basename, dirname } from '../format'
  import { grepRegex, splitMatches } from '../grep'
  import { app, type Repo } from '../state.svelte'
  import type { GrepHit, GrepResult } from '../types'
  import CodeView from './CodeView.svelte'
  import Icon from './Icon.svelte'

  let { repo }: { repo: Repo } = $props()

  const q = last
  let result = $state.raw<GrepResult | null>(null)
  let error = $state<string | null>(null)
  let loading = $state(false)
  let idx = $state(0)
  let input: HTMLInputElement | undefined = $state()
  let list: HTMLDivElement | undefined = $state()
  let preview = $state.raw<{ path: string; lines: string[] | null; note: string | null } | null>(null)
  const cache = new Map<string, { lines: string[] | null; note: string | null }>()
  let seq = 0

  const re = $derived(grepRegex({ ...q }))
  const hits = $derived(result?.hits ?? [])
  const hit = $derived<GrepHit | undefined>(hits[idx])

  // 처음 열 때: 화면에서 고른 글자가 있으면 그것으로 찾는다
  onMount(() => {
    const sel = window.getSelection()?.toString().trim() ?? ''
    if (sel && !sel.includes('\n') && sel.length <= 200) q.text = sel
    input?.focus()
    input?.select()
  })

  // 검색어·옵션이 바뀌면 잠시 뒤 찾는다
  $effect(() => {
    const query = { ...q }
    const my = ++seq
    if (!query.text.trim()) {
      result = null
      error = null
      loading = false
      return
    }
    loading = true
    const timer = setTimeout(async () => {
      try {
        const r = await app.backend.contentSearch(repo.root, query)
        if (my !== seq) return
        result = r
        error = null
        idx = 0
        list?.scrollTo({ top: 0 })
      } catch (e) {
        if (my === seq) error = errorMessage(e)
      } finally {
        if (my === seq) loading = false
      }
    }, 250)
    return () => clearTimeout(timer)
  })

  // 고른 결과의 파일 미리보기 (지금 파일)
  $effect(() => {
    const path = hit?.path
    if (!path) {
      preview = null
      return
    }
    const got = cache.get(path)
    if (got) {
      preview = { path, ...got }
      return
    }
    app.backend
      .fileContent(repo.root, path, null)
      .then((b) => {
        const v = b.binary ? { lines: null, note: '이진 파일입니다' } : { lines: b.text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'), note: null }
        cache.set(path, v)
        if (hit?.path === path) preview = { path, ...v }
      })
      .catch((e) => {
        if (hit?.path === path) preview = { path, lines: null, note: errorMessage(e) }
      })
  })

  function close() {
    app.findInFiles = false
  }

  /** 그 파일의 이력을 열고 맞은 줄로 (파일이 바뀌어 있으면 맨 위 "커밋하지 않은 변경"의 내용) */
  function choose(h: GrepHit | undefined) {
    if (!h) return
    close()
    repo.openFileHistory({ path: h.path, line: h.line })
  }

  function move(d: number) {
    idx = Math.max(0, Math.min(hits.length - 1, idx + d))
    list?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      move(e.key === 'PageDown' ? 10 : -10)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(hit)
    } else if (e.altKey && e.code === 'KeyC') {
      e.preventDefault()
      q.caseSensitive = !q.caseSensitive
    } else if (e.altKey && e.code === 'KeyW') {
      e.preventDefault()
      q.wholeWord = !q.wholeWord
    } else if (e.altKey && e.code === 'KeyX') {
      e.preventDefault()
      q.regex = !q.regex
    }
  }

  const summary = $derived(
    !q.text.trim()
      ? ''
      : error
        ? ''
        : result
          ? `${result.hits.length.toLocaleString()}개${result.truncated ? '+' : ''} · 파일 ${result.files.toLocaleString()}개`
          : '찾는 중…',
  )
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={close}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="fif" role="dialog" aria-label="내용으로 찾기" tabindex="-1" onkeydown={onkey}>
  <div class="head">
    <b>내용으로 찾기</b>
    <span class="muted">{summary}</span>
    {#if loading && result}<span class="spin muted"><Icon name="refresh" size={12} /></span>{/if}
    <span class="grow"></span>
    <label class="mask" title="쉼표로 여러 개, 앞에 !를 붙이면 빼기. 비우면 모든 파일">
      파일 마스크
      <input type="text" bind:value={q.mask} placeholder="*.java, *.xml, !*.min.js" spellcheck="false" />
    </label>
  </div>
  <div class="in">
    <Icon name="search" size={15} />
    <input bind:this={input} bind:value={q.text} placeholder="찾을 글자 (작업 트리의 파일 내용 · 무시한 파일·이진 파일은 빼고)" spellcheck="false" />
    <button class="tg" class:on={q.caseSensitive} title="대소문자 구분 (Alt+C)" onclick={() => (q.caseSensitive = !q.caseSensitive)}>Cc</button>
    <button class="tg" class:on={q.wholeWord} title="단어 단위 (Alt+W)" onclick={() => (q.wholeWord = !q.wholeWord)}>W</button>
    <button class="tg" class:on={q.regex} title="정규식 (Alt+X)" onclick={() => (q.regex = !q.regex)}>.*</button>
  </div>
  <div class="list" bind:this={list}>
    {#if error}
      <div class="none err">{error}</div>
    {:else}
      {#each hits as h, i (i)}
        <button class="row" class:sel={i === idx} data-i={i} onclick={() => (idx = i)} ondblclick={() => choose(h)}>
          <span class="tx mono">
            {#each splitMatches(h.text, re) as p, k (k)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
          </span>
          <span class="loc" title={h.path}>{basename(h.path)} <span class="ln">{h.line}</span></span>
        </button>
      {:else}
        <div class="none muted">{!q.text.trim() ? '찾을 글자를 넣으세요' : loading ? '찾는 중…' : '맞는 곳이 없습니다'}</div>
      {/each}
    {/if}
  </div>
  <div class="pv-head">
    {#if hit}
      <Icon name="file" size={13} />
      <span class="pv-name">{basename(hit.path)}</span>
      <span class="muted pv-dir">{dirname(hit.path)}</span>
      <span class="grow"></span>
      <span class="muted">{hit.line}줄 · 지금 파일</span>
    {/if}
  </div>
  <div class="pv">
    {#if preview && hit && preview.path === hit.path}
      {#if preview.lines}
        <CodeView lines={preview.lines} path={preview.path} range={[hit.line, hit.line]} scrollTo={hit.line} />
      {:else}
        <div class="none muted">{preview.note}</div>
      {/if}
    {/if}
  </div>
  <div class="foot muted">
    <span>↑↓ 고르기 · Enter·더블클릭: 파일 이력에서 그 줄 보기 · Esc: 닫기</span>
    <span class="grow"></span>
    {#if result?.truncated}<span>너무 많아 앞의 {result.hits.length.toLocaleString()}개만 보입니다</span>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(0 0 0 / 0.25);
  }
  .fif {
    position: fixed;
    top: 6vh;
    left: 50%;
    z-index: 81;
    display: flex;
    flex-direction: column;
    width: min(1180px, 94vw);
    height: min(820px, 86vh);
    transform: translateX(-50%);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.4);
    overflow: hidden;
    outline: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    font-size: 12.5px;
  }
  .grow {
    flex: 1;
  }
  .spin {
    display: inline-flex;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .mask {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .mask input {
    width: 220px;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 8px;
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
  .tg {
    min-width: 28px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: none;
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .tg:hover {
    background: var(--hover);
  }
  .tg.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--text);
  }
  .list {
    flex: 0 0 38%;
    overflow: auto;
    padding: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
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
  .tx {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    font-size: 12.5px;
  }
  .tx mark {
    border-radius: 2px;
    background: color-mix(in srgb, #e0a030 55%, transparent);
    color: inherit;
  }
  .loc {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12px;
  }
  .ln {
    color: var(--faint);
  }
  .pv-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 12px;
    border-top: 1px solid var(--border-strong);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .pv-name {
    font-weight: 600;
  }
  .pv-dir {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pv {
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }
  .none {
    padding: 12px;
  }
  .err {
    color: var(--err);
    white-space: pre-wrap;
  }
  .foot {
    display: flex;
    gap: 8px;
    padding: 5px 12px;
    border-top: 1px solid var(--border-strong);
    font-size: 11.5px;
  }
</style>
