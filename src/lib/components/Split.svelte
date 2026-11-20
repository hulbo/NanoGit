<script lang="ts">
  // 두 칸 나누기 (끌어서 크기 조절). 크기는 브라우저 저장소에 기억한다.
  import type { Snippet } from 'svelte'

  let {
    dir = 'h',
    initial = 0.5,
    min = 120,
    key,
    a,
    b,
  }: { dir?: 'h' | 'v'; initial?: number; min?: number; key: string; a: Snippet; b: Snippet } = $props()

  const stored = (() => {
    try {
      const v = Number(localStorage.getItem(`split:${key}`))
      return v > 0 && v < 1 ? v : null
    } catch {
      return null
    }
  })()
  // 처음 값만 쓴다 (그 뒤로는 사용자가 끈 크기)
  // svelte-ignore state_referenced_locally
  let ratio = $state(stored ?? initial)
  let box: HTMLDivElement | undefined = $state()
  let dragging = $state(false)

  function down(e: PointerEvent) {
    e.preventDefault()
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (!dragging || !box) return
    const r = box.getBoundingClientRect()
    const total = dir === 'h' ? r.width : r.height
    const pos = dir === 'h' ? e.clientX - r.left : e.clientY - r.top
    const lo = Math.min(0.45, min / total)
    ratio = Math.max(lo, Math.min(1 - lo, pos / total))
  }
  function up() {
    if (!dragging) return
    dragging = false
    try {
      localStorage.setItem(`split:${key}`, String(ratio))
    } catch {
      // 저장하지 못해도 이번 실행에서는 그대로 쓴다
    }
  }
</script>

<div class="split {dir}" class:dragging bind:this={box}>
  <div class="pane" style="flex: 0 0 {ratio * 100}%">{@render a()}</div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="handle" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></div>
  <div class="pane rest">{@render b()}</div>
</div>

<style>
  .split {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .split.v {
    flex-direction: column;
  }
  .pane {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .rest {
    flex: 1;
  }
  .handle {
    flex: none;
    background: var(--border-strong);
    position: relative;
    z-index: 2;
  }
  .h > .handle {
    width: 1px;
    cursor: col-resize;
  }
  .v > .handle {
    height: 1px;
    cursor: row-resize;
  }
  .handle::after {
    content: '';
    position: absolute;
    inset: -3px;
  }
  .dragging {
    user-select: none;
  }
  .dragging .handle,
  .handle:hover {
    background: var(--accent);
  }
</style>
