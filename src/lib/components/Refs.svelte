<script lang="ts">
  // 커밋 옆 브랜치·태그 배지. 같은 이름의 로컬·원격은 하나로 합쳐 보여 준다
  import type { RefLabel } from '../types'

  let { refs }: { refs: RefLabel[] } = $props()

  interface Badge {
    kind: string
    name: string
    synced?: boolean
    title: string
  }

  const badges = $derived.by((): Badge[] => {
    const head = refs.find((r) => r.kind === 'head')
    const locals = refs.filter((r) => r.kind === 'local')
    const remotes = refs.filter((r) => r.kind === 'remote')
    const out: Badge[] = []
    for (const l of locals) {
      const twin = remotes.find((r) => r.name.split('/').slice(1).join('/') === l.name)
      const isHead = head?.name === l.name
      out.push({
        kind: isHead ? 'head' : 'local',
        name: l.name,
        synced: !!twin,
        title: `${isHead ? '현재 브랜치 ' : '로컬 브랜치 '}${l.name}${twin ? ` · ${twin.name}와 같은 위치` : ''}`,
      })
    }
    if (head?.name === 'HEAD') out.unshift({ kind: 'head', name: 'HEAD', title: '분리된 HEAD' })
    for (const r of remotes) {
      const short = r.name.split('/').slice(1).join('/')
      if (locals.some((l) => l.name === short)) continue
      out.push({ kind: 'remote', name: r.name, title: `원격 브랜치 ${r.name}` })
    }
    for (const t of refs.filter((r) => r.kind === 'tag')) out.push({ kind: 'tag', name: t.name, title: `태그 ${t.name}` })
    return out
  })
</script>

{#each badges as b (b.kind + b.name)}
  <span class="ref {b.kind}" title={b.title}>{b.kind === 'tag' ? '◆ ' : ''}{b.name}{#if b.synced}<span class="sync" title="원격과 같은 위치">⇅</span>{/if}</span>
{/each}

<style>
  .ref {
    margin-right: 4px;
  }
  .sync {
    opacity: 0.8;
    font-weight: 400;
  }
</style>
