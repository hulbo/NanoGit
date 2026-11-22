<script lang="ts">
  // 조작 확인·입력 대화상자 (app.ask). Enter로 확인, Esc로 취소. 여러 줄 칸에서는 Ctrl+Enter로 확인
  import { initialValues, missingField, type DialogSpec, type DialogValues } from '../dialog'
  import Icon from './Icon.svelte'

  let { spec, resolve }: { spec: DialogSpec; resolve: (v: DialogValues | null) => void } = $props()

  // svelte-ignore state_referenced_locally
  let values = $state<DialogValues>(initialValues(spec.fields))
  let problem = $state<string | null>(null)
  let box: HTMLDivElement | undefined = $state()

  $effect(() => {
    // 첫 입력 칸(없으면 확인 버튼)에 초점
    const el = box?.querySelector<HTMLElement>('input[type=text], textarea, select') ?? box?.querySelector<HTMLElement>('button.ok')
    el?.focus()
    if (el instanceof HTMLInputElement) el.select()
  })

  function ok() {
    const missing = missingField(spec.fields, values)
    if (missing) {
      problem = `${missing}을(를) 입력하세요`
      return
    }
    const bad = spec.validate?.(values) ?? null
    if (bad) {
      problem = bad
      return
    }
    resolve($state.snapshot(values))
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      resolve(null)
    } else if (e.key === 'Enter' && (e.ctrlKey || !(e.target instanceof HTMLTextAreaElement))) {
      if (e.target instanceof HTMLButtonElement && !e.target.classList.contains('ok')) return
      e.preventDefault()
      ok()
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={() => spec.cancel !== null && resolve(null)}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="dlg" role="dialog" tabindex="-1" aria-label={spec.title} bind:this={box} onkeydown={onkey}>
  <div class="pane-head">
    {#if spec.icon}<Icon name={spec.icon} size={15} />{/if}
    <span class="title">{spec.title}</span>
    <span class="grow"></span>
    <button class="ghost" title="닫기 (Esc)" onclick={() => resolve(null)}><Icon name="x" size={13} /></button>
  </div>
  <div class="body">
    {#each spec.fields as f, i (i)}
      {#if f.kind === 'text'}
        <label class="field">
          <span>{f.label}</span>
          {#if f.multiline}
            <textarea rows="4" bind:value={values[f.key]} placeholder={f.placeholder ?? ''} class:mono={f.mono}></textarea>
          {:else}
            <input type="text" bind:value={values[f.key]} placeholder={f.placeholder ?? ''} class:mono={f.mono} spellcheck="false" />
          {/if}
        </label>
      {:else if f.kind === 'select'}
        <label class="field">
          <span>{f.label}</span>
          <select bind:value={values[f.key]}>
            {#each f.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
          {#if f.hint}<small>{f.hint}</small>{/if}
        </label>
      {:else if f.kind === 'check'}
        <label class="chk" class:danger={f.danger}>
          <input type="checkbox" bind:checked={values[f.key] as boolean} />
          <span>{f.label}{#if f.hint}<small>{f.hint}</small>{/if}</span>
        </label>
      {:else if f.kind === 'info'}
        <div class="info {f.tone ?? ''}">
          {#if f.tone === 'warn' || f.tone === 'danger'}<Icon name="warning" size={14} />{/if}
          <span>{f.text}</span>
        </div>
      {:else if f.kind === 'list'}
        {@const max = f.max ?? 12}
        <div class="list">
          {#if f.label}<div class="lt">{f.label}</div>{/if}
          {#each f.items.slice(0, max) as item, j (j)}<div class="li mono">{item}</div>{/each}
          {#if f.items.length > max}<div class="li muted">… 외 {f.items.length - max}개</div>{/if}
        </div>
      {:else if f.kind === 'output'}
        <pre class="out">{f.text}</pre>
      {/if}
    {/each}
    {#if problem}<div class="info danger"><Icon name="warning" size={14} /><span>{problem}</span></div>{/if}
  </div>
  <div class="foot">
    <span class="grow"></span>
    {#if spec.cancel !== null}<button class="ghost" onclick={() => resolve(null)}>{spec.cancel ?? '취소'}</button>{/if}
    <button class="ok" class:danger={spec.danger} onclick={ok}>{spec.ok ?? '확인'}</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgb(0 0 0 / 0.35);
  }
  .dlg {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 91;
    display: flex;
    flex-direction: column;
    width: min(560px, 92vw);
    max-height: 86vh;
    transform: translate(-50%, -50%);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.4);
    overflow: hidden;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    overflow: auto;
    min-height: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field > span {
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
  }
  .field small {
    color: var(--muted);
    font-size: 11.5px;
  }
  textarea {
    resize: vertical;
    min-height: 70px;
    font: inherit;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .chk {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    cursor: pointer;
  }
  .chk input {
    margin-top: 3px;
  }
  .chk small {
    display: block;
    color: var(--muted);
    font-size: 11.5px;
  }
  .chk.danger > span {
    color: var(--err);
  }
  .info {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .info :global(svg) {
    margin-top: 3px;
    flex: none;
  }
  .info.warn {
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    color: var(--warn);
  }
  .info.danger {
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--err) 14%, transparent);
    color: var(--err);
  }
  .info.muted {
    color: var(--muted);
    font-size: 12px;
  }
  .info.ok {
    color: var(--ok);
  }
  .list {
    max-height: 220px;
    overflow: auto;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--panel-2);
  }
  .lt {
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 700;
  }
  .li {
    overflow: hidden;
    font-size: 12px;
    line-height: 1.7;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .out {
    max-height: 50vh;
    margin: 0;
    padding: 10px;
    overflow: auto;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--panel-2);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }
  .foot {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border-strong);
    background: var(--panel);
  }
  .ok {
    min-width: 84px;
    padding: 5px 14px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .ok.danger {
    border-color: var(--err);
    background: var(--err);
  }
  .ok:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }
</style>
