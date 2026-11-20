<script lang="ts">
  // 열린 저장소가 없을 때
  import { app } from '../state.svelte'
  import Icon from './Icon.svelte'
</script>

<div class="welcome">
  <div class="card">
    <img src="/icon.svg" alt="" width="64" height="64" />
    <h1>NanoGit</h1>
    <p class="lead">AI가 하는 git 작업을 지켜보는 가벼운 git 모니터</p>
    <ul>
      <li><Icon name="eye" size={15} />파일 변경·커밋·push를 실시간으로</li>
      <li><Icon name="activity" size={15} />AI가 한 작업 타임라인, reset·강제 push 경고</li>
      <li><Icon name="push" size={15} />push 전에 올라갈 커밋과 변경 확인</li>
      <li><Icon name="history" size={15} />이름 변경까지 따라가는 파일 이력·blame·줄 이력</li>
    </ul>
    <button class="primary big" onclick={() => app.addRepo()}><Icon name="folder" size={16} />저장소 폴더 열기</button>
    {#if app.settings.repos.length}
      <div class="recent">
        <div class="muted">최근 저장소</div>
        {#each app.settings.repos.slice(0, 10) as r (r.path)}
          <div class="r">
            <button class="open" onclick={() => app.addRepo(r.path)}><b>{r.name}</b><span class="muted">{r.path}</span></button>
            <button class="ghost" title="목록에서 빼기" onclick={() => app.forgetRepo(r.path)}><Icon name="x" size={12} /></button>
          </div>
        {/each}
      </div>
    {/if}
    {#if app.backend?.isMock}
      <p class="muted small">브라우저 미리보기: 가짜 저장소로 동작합니다. "저장소 폴더 열기"를 누르면 샘플 저장소가 열립니다.</p>
    {/if}
  </div>
</div>

<style>
  .welcome {
    display: grid;
    place-items: center;
    height: 100%;
    overflow: auto;
  }
  .card {
    width: min(520px, 92vw);
    padding: 28px;
    text-align: center;
  }
  h1 {
    margin: 10px 0 4px;
    font-size: 24px;
  }
  .lead {
    margin: 0 0 18px;
    color: var(--text-2);
  }
  ul {
    list-style: none;
    margin: 0 auto 22px;
    padding: 0;
    display: inline-flex;
    flex-direction: column;
    gap: 7px;
    text-align: left;
    color: var(--text-2);
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .big {
    height: 34px;
    padding: 0 18px;
    font-size: 14px;
  }
  .recent {
    margin-top: 24px;
    text-align: left;
  }
  .r {
    display: flex;
    align-items: center;
  }
  .open {
    flex: 1;
    display: flex;
    gap: 10px;
    align-items: baseline;
    min-width: 0;
    padding: 6px 8px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .open:hover {
    background: var(--hover);
  }
  .small {
    font-size: 12px;
    margin-top: 18px;
  }
</style>
