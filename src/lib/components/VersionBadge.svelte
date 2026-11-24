<script lang="ts">
  // 상태 표시줄 오른쪽: 지금 버전, 새 버전이 있으면 업데이트 버튼, 받는 중이면 진행률
  import { app } from '../state.svelte'
  import Icon from './Icon.svelte'

  const progress = $derived(app.updateProgress)
</script>

{#if progress !== null}
  <span class="upd busy" title="새 버전을 받는 중입니다. 다 받으면 설치 프로그램이 뜨고 NanoGit이 다시 켜집니다">
    <Icon name="pull" size={12} />업데이트 받는 중{progress >= 0 ? ` ${Math.round(progress * 100)}%` : '…'}
  </span>
{:else if app.update}
  <button class="upd" title="NanoGit {app.update.version}로 업데이트 (지금 {app.update.current})" onclick={() => void app.installUpdate()}>
    <Icon name="pull" size={12} />새 버전 {app.update.version}
  </button>
{/if}
<span class="muted">NanoGit {app.info?.version ?? ''}</span>

<style>
  .upd {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 7px;
    border: 0;
    border-radius: 9px;
    background: var(--accent);
    color: #fff;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .upd:hover {
    filter: brightness(1.1);
  }
  .upd.busy {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--accent-text);
    cursor: default;
  }
</style>
