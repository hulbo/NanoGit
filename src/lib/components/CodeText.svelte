<script lang="ts">
  // 코드 한 줄: 구문 강조 조각이 있으면 색을 입히고, 바뀐 부분(mark)은 배경으로 표시한다
  import { withMark, type Tok } from '../highlight'

  let { text, toks = null, mark }: { text: string; toks?: Tok[] | null; mark?: [number, number] } = $props()

  const parts = $derived(toks ? withMark(toks, mark) : null)
</script>

{#if parts}{#each parts as p, i (i)}{#if p.m}<mark class={p.c}>{p.t}</mark>{:else if p.c}<span class={p.c}>{p.t}</span>{:else}{p.t}{/if}{/each}{:else if mark}{text.slice(0, mark[0])}<mark>{text.slice(mark[0], mark[1])}</mark>{text.slice(mark[1])}{:else}{text}{/if}
