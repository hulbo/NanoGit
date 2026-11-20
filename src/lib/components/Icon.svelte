<script lang="ts" module>
  export type IconName =
    | 'plus'
    | 'folder'
    | 'chevron-right'
    | 'chevron-down'
    | 'copy'
    | 'gear'
    | 'search'
    | 'refresh'
    | 'external'
    | 'x'
    | 'file'
    | 'terminal'
    | 'warning'
    | 'branch'
    | 'more'
    | 'commit'
    | 'history'
    | 'activity'
    | 'push'
    | 'fetch'
    | 'tag'
    | 'cloud'
    | 'stash'
    | 'files'
    | 'status'
    | 'eye'
    | 'compare'
    | 'blame'
    | 'list'
    | 'tree'
    | 'back'
    | 'editor'
    | 'check'
    | 'lines'
</script>

<script lang="ts">
  let { name, size = 16, title }: { name: IconName; size?: number; title?: string } = $props()
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={title ? undefined : 'true'}
  role={title ? 'img' : undefined}
  class="icon"
>
  {#if title}<title>{title}</title>{/if}
  {#if name === 'plus'}
    <path d="M8 3v10M3 8h10" />
  {:else if name === 'folder'}
    <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
  {:else if name === 'chevron-right'}
    <path d="M6 4l4 4-4 4" />
  {:else if name === 'chevron-down'}
    <path d="M4 6l4 4 4-4" />
  {:else if name === 'copy'}
    <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1" />
    <path d="M3 10.5V4c0-.6.4-1 1-1h6.5" />
  {:else if name === 'gear'}
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" />
  {:else if name === 'search'}
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3.5 3.5" />
  {:else if name === 'refresh'}
    <path d="M13 3v3.5H9.5" />
    <path d="M12.6 6.5A5 5 0 1 0 13 9.5" />
  {:else if name === 'external'}
    <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />
  {:else if name === 'x'}
    <path d="M4 4l8 8M12 4l-8 8" />
  {:else if name === 'file'}
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
  {:else if name === 'terminal'}
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M4.5 6l2 2-2 2M8 10.5h3.5" />
  {:else if name === 'branch'}
    <circle cx="5" cy="3.5" r="1.5" />
    <circle cx="5" cy="12.5" r="1.5" />
    <circle cx="11" cy="4.5" r="1.5" />
    <path d="M5 5v6M11 6c0 3.2-6 2.6-6 5" />
  {:else if name === 'more'}
    <g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></g>
  {:else if name === 'warning'}
    <path d="M8 2.5L14 13H2z" />
    <path d="M8 6.5v3M8 11.3v.2" />
  {:else if name === 'commit'}
    <circle cx="8" cy="8" r="2.6" />
    <path d="M1.5 8h3.9M10.6 8h3.9" />
  {:else if name === 'history'}
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M2.3 2.6v2.6h2.6" />
    <path d="M8 5v3.2l2 1.3" />
  {:else if name === 'activity'}
    <path d="M1.5 8.5h2.8l1.8-4.5 3.4 8.5 1.9-4h3.1" />
  {:else if name === 'push'}
    <path d="M8 13V3.5M4.2 7.2L8 3.4l3.8 3.8" />
    <path d="M3 13.5h10" />
  {:else if name === 'fetch'}
    <path d="M4.5 11.5H4a3 3 0 0 1-.4-6 4.3 4.3 0 0 1 8.3-.6 2.9 2.9 0 0 1 .4 5.8" />
    <path d="M8 7.5v6M6 11.5l2 2 2-2" />
  {:else if name === 'tag'}
    <path d="M2.5 2.5h5.2l6 6-5.2 5.2-6-6z" />
    <circle cx="5.3" cy="5.3" r="1" />
  {:else if name === 'cloud'}
    <path d="M4.5 12.5H4a3 3 0 0 1-.4-6 4.3 4.3 0 0 1 8.3-.6 3 3 0 0 1 0 6.6z" />
  {:else if name === 'stash'}
    <path d="M2.5 6h11v7.5h-11z" />
    <path d="M3.5 3h9l1 3h-11z" />
    <path d="M6.5 8.5h3" />
  {:else if name === 'files'}
    <path d="M5.5 2.5h4.5l2.5 2.5v6.5h-7z" />
    <path d="M3.5 5v8.5h6" />
  {:else if name === 'status'}
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M5 6h6M5 8.5h6M5 11h3.5" />
  {:else if name === 'eye'}
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.9" />
  {:else if name === 'compare'}
    <path d="M5 2.5v11M11 2.5v11" />
    <path d="M2.5 5.5L5 3l2.5 2.5M8.5 10.5L11 13l2.5-2.5" />
  {:else if name === 'blame'}
    <circle cx="4.5" cy="5" r="2" />
    <path d="M1.5 12.5c.4-2 1.5-3 3-3s2.6 1 3 3" />
    <path d="M9.5 4.5h5M9.5 8h5M9.5 11.5h5" />
  {:else if name === 'list'}
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <path d="M2.5 4h.1M2.5 8h.1M2.5 12h.1" stroke-width="2" />
  {:else if name === 'tree'}
    <path d="M2.5 3h5M5 6h6M5 9.5h6M5 13h6M3.5 3v10h1.5M3.5 6h1.5M3.5 9.5h1.5" />
  {:else if name === 'back'}
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  {:else if name === 'editor'}
    <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
  {:else if name === 'check'}
    <path d="M3 8.5l3.2 3L13 4.5" />
  {:else if name === 'lines'}
    <path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h7M2.5 12.5h7" />
    <path d="M12 9v4.5" stroke-width="2" />
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
