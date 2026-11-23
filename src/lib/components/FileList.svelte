<script lang="ts" module>
  export interface ListFile {
    path: string
    oldPath?: string | null
    status: string
    additions?: number | null
    deletions?: number | null
    binary?: boolean
    mtime?: number | null
  }
</script>

<script lang="ts">
  // 바뀐 파일 목록 (목록 / 트리). 고르면 onselect, 우클릭은 oncontext
  import { basename, dirname, relative, statusName } from '../format'
  import Icon, { type IconName } from './Icon.svelte'

  let {
    files,
    selected = null,
    onselect,
    oncontext,
    ondblclick,
    tree = false,
    showTime = false,
    now = Date.now(),
    action,
  }: {
    files: ListFile[]
    selected?: string | null
    onselect: (f: ListFile) => void
    oncontext?: (e: MouseEvent, f: ListFile) => void
    ondblclick?: (f: ListFile) => void
    tree?: boolean
    showTime?: boolean
    now?: number
    /** 줄마다 마우스를 올리면 보이는 버튼 (스테이지·언스테이지). 스페이스 키로도 실행 */
    action?: { icon: IconName; title: string; run: (f: ListFile) => void }
  } = $props()

  interface Row {
    kind: 'dir' | 'file'
    depth: number
    name: string
    file?: ListFile
    key: string
  }

  let collapsed = $state<Set<string>>(new Set())

  const rows = $derived.by((): Row[] => {
    if (!tree) return files.map((f) => ({ kind: 'file', depth: 0, name: f.path, file: f, key: f.path }))
    // 폴더별로 묶고, 하위 폴더가 하나뿐인 폴더는 이어 붙인다
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
    const out: Row[] = []
    const seen = new Set<string>()
    for (const f of sorted) {
      const dir = dirname(f.path)
      if (dir && !seen.has(dir)) {
        seen.add(dir)
        out.push({ kind: 'dir', depth: 0, name: dir, key: `d:${dir}` })
      }
      if (!dir || !collapsed.has(dir)) out.push({ kind: 'file', depth: dir ? 1 : 0, name: basename(f.path), file: f, key: f.path })
    }
    return out
  })

  function toggle(dir: string) {
    const next = new Set(collapsed)
    if (next.has(dir)) next.delete(dir)
    else next.add(dir)
    collapsed = next
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === ' ' && action) {
      const f = files.find((x) => x.path === selected)
      if (f) {
        e.preventDefault()
        action.run(f)
      }
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const list = rows.filter((r) => r.file).map((r) => r.file!)
    const i = list.findIndex((f) => f.path === selected)
    const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) onselect(next)
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="list" tabindex="0" role="listbox" onkeydown={onkey}>
  {#each rows as r (r.key)}
    {#if r.kind === 'dir'}
      <button class="row dir" onclick={() => toggle(r.name)}>
        <Icon name={collapsed.has(r.name) ? 'chevron-right' : 'chevron-down'} size={12} />
        <Icon name="folder" size={14} />
        <span class="name">{r.name}</span>
      </button>
    {:else if r.file}
      {@const f = r.file}
      <button
        class="row"
        class:sel={selected === f.path}
        style="padding-left:{8 + r.depth * 18}px"
        role="option"
        aria-selected={selected === f.path}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        onclick={() => onselect(f)}
        ondblclick={() => ondblclick?.(f)}
        oncontextmenu={(e) => {
          onselect(f)
          oncontext?.(e, f)
        }}
      >
        <span class="st st-{f.status}" title={statusName(f.status)}>{f.status}</span>
        <span class="name">
          {#if tree}{r.name}{:else}{@const dir = dirname(f.path)}<span class="base">{basename(f.path)}</span>{#if dir}<span class="dirp">{dir}</span>{/if}{/if}
          {#if f.oldPath && f.oldPath !== f.path}<span class="from">← {f.oldPath}</span>{/if}
        </span>
        {#if showTime && f.mtime}
          {@const age = now - f.mtime}
          <span class="time" class:fresh={age < 15000}>{relative(f.mtime, now)}</span>
        {/if}
        {#if f.binary}
          <span class="num muted">이진</span>
        {:else if f.additions != null || f.deletions != null}
          <span class="num mono"><span class="add-n">+{f.additions ?? 0}</span> <span class="del-n">-{f.deletions ?? 0}</span></span>
        {/if}
        {#if action}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
          <span
            class="act"
            role="button"
            title="{action.title} (스페이스)"
            onclick={(e) => {
              e.stopPropagation()
              action.run(f)
            }}
            ondblclick={(e) => e.stopPropagation()}><Icon name={action.icon} size={13} /></span
          >
        {/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .act {
    display: none;
    place-items: center;
    flex: none;
    width: 20px;
    height: 18px;
    margin-left: 2px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text-2);
  }
  .row:hover .act,
  .row.sel .act {
    display: grid;
  }
  .act:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .list {
    outline: none;
    padding: 2px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 24px;
    padding: 0 8px;
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
  .dir {
    color: var(--text-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirp {
    margin-left: 6px;
    color: var(--muted);
    font-size: 12px;
  }
  .from {
    margin-left: 6px;
    color: var(--muted);
    font-size: 12px;
  }
  .time {
    flex: none;
    color: var(--muted);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .time.fresh {
    padding: 0 5px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warn) 22%, transparent);
    color: var(--warn);
    font-weight: 600;
  }
  .num {
    flex: none;
    font-size: 11.5px;
  }
</style>
