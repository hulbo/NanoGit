<script lang="ts">
  // 히스토리 그래프 한 행
  import type { GraphRow } from '../graph'

  let { row, height = 24, lane = 14, unpushed = false }: { row: GraphRow; height?: number; lane?: number; unpushed?: boolean } = $props()

  const x = (i: number) => lane / 2 + i * lane
  const mid = $derived(height / 2)

  function path(kind: 'pass' | 'in' | 'out', from: number, to: number): string {
    const [y1, y2] = kind === 'pass' ? [0, height] : kind === 'in' ? [0, mid] : [mid, height]
    const x1 = x(from)
    const x2 = x(to)
    if (x1 === x2) return `M${x1} ${y1}V${y2}`
    const ym = (y1 + y2) / 2
    return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`
  }
</script>

<svg width={Math.max(1, row.width) * lane} {height} class="graph">
  {#each row.segs as s, i (i)}
    <path d={path(s.kind, s.from, s.to)} stroke="var(--lane-{s.color})" />
  {/each}
  {#if unpushed}
    <circle cx={x(row.col)} cy={mid} r="4.5" fill="var(--bg)" stroke="var(--lane-{row.color})" stroke-width="2" />
  {:else}
    <circle cx={x(row.col)} cy={mid} r={row.merge ? 3.5 : 4.5} fill="var(--lane-{row.color})" stroke="var(--bg)" stroke-width="1.5" />
  {/if}
</svg>

<style>
  .graph {
    display: block;
    flex: none;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-width: 2;
  }
</style>
