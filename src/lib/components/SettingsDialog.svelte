<script lang="ts">
  // 설정
  import { app } from '../state.svelte'
  import Icon from './Icon.svelte'

  const s = app.settings

  function save() {
    app.applyTheme()
    app.setupFetchTimer()
    app.setupUpdateTimer()
    void app.persist()
  }

  let checking = $state(false)
  async function checkNow() {
    checking = true
    await app.checkUpdate(true)
    checking = false
  }

  /** Windows 시작 시 실행: 저장할 때 레지스트리에 등록하므로 실패하면 되돌린다 */
  async function toggleAutostart(e: Event) {
    const el = e.currentTarget as HTMLInputElement
    s.startWithWindows = el.checked
    if (!(await app.persist())) {
      s.startWithWindows = !el.checked
      el.checked = s.startWithWindows
    }
  }

  function close() {
    save()
    app.settingsOpen = false
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={close}></div>
<div class="dlg" role="dialog" aria-label="설정">
  <div class="pane-head">
    <Icon name="gear" size={15} />
    <span class="title">설정</span>
    <span class="grow"></span>
    <button class="ghost" onclick={close}><Icon name="x" size={13} /></button>
  </div>
  <div class="body">
    <label>
      <span>테마</span>
      <select bind:value={s.theme} onchange={save}>
        <option value="system">시스템 설정 따르기</option>
        <option value="dark">다크</option>
        <option value="light">라이트</option>
      </select>
    </label>
    <div class="row">
      <span>Windows 알림</span>
      <div class="checks">
        <label class="chk"><input type="checkbox" bind:checked={s.notifyEnabled} onchange={save} />새 활동을 알림으로 보기</label>
        <div class="sub" class:off={!s.notifyEnabled}>
          <label class="chk"><input type="checkbox" bind:checked={s.notifyCommit} disabled={!s.notifyEnabled} onchange={save} />커밋</label>
          <label class="chk"><input type="checkbox" bind:checked={s.notifyPush} disabled={!s.notifyEnabled} onchange={save} />push</label>
          <label class="chk"><input type="checkbox" bind:checked={s.notifyWarn} disabled={!s.notifyEnabled} onchange={save} />주의 (reset·강제 push·amend·rebase)</label>
          <label class="chk"><input type="checkbox" bind:checked={s.notifyBranch} disabled={!s.notifyEnabled} onchange={save} />브랜치 (전환·병합·pull)</label>
          <label class="chk"><input type="checkbox" bind:checked={s.notifyWhenFocused} disabled={!s.notifyEnabled} onchange={save} />NanoGit을 보고 있을 때도 알림</label>
        </div>
        <div class="test">
          <button class="ghost on" disabled={!s.notifyEnabled} onclick={() => app.testNotify()}><Icon name="check" size={13} />알림 시험</button>
          <small>여러 개가 한꺼번에 생기면 묶어서 알립니다</small>
        </div>
      </div>
    </div>
    <div class="row">
      <span>트레이</span>
      <div class="checks">
        <label class="chk"><input type="checkbox" bind:checked={s.closeToTray} onchange={save} />창을 닫으면 트레이로 숨기고 감시 계속</label>
        <label class="chk"><input type="checkbox" checked={s.startWithWindows} onchange={toggleAutostart} />Windows 시작 시 트레이로 실행</label>
        <small>트레이 아이콘: 클릭하면 창을 열고, 우클릭 메뉴에서 저장소별 상태·알림 켜고 끄기·fetch·종료. 새 활동이 있으면 빨간 점</small>
      </div>
    </div>
    <div class="row">
      <span>직접 조작</span>
      <div class="checks">
        <label class="chk"><input type="checkbox" bind:checked={s.readOnly} onchange={save} />감시 전용 모드 (커밋·push 같은 조작 버튼을 숨기고 막음)</label>
        <small>AI에게만 git을 맡기고 NanoGit은 지켜보기만 하려면 켜세요</small>
      </div>
    </div>
    <label>
      <span>Pull 방식</span>
      <select bind:value={s.pullMode} onchange={save} disabled={s.readOnly}>
        <option value="merge">병합 (git pull --no-rebase)</option>
        <option value="rebase">rebase (git pull --rebase)</option>
        <option value="ff-only">fast-forward만</option>
      </select>
    </label>
    <label>
      <span>주기적 fetch</span>
      <select bind:value={s.fetchMinutes} onchange={save}>
        <option value={0}>끔</option>
        <option value={5}>5분마다</option>
        <option value={10}>10분마다</option>
        <option value={30}>30분마다</option>
      </select>
      <small>원격 상태(↓)를 자동으로 갱신합니다. 인증 창이 뜰 수 있어 기본은 끔</small>
    </label>
    <label>
      <span>히스토리 기본 범위</span>
      <select bind:value={s.historyScope} onchange={save}>
        <option value="all">모든 브랜치</option>
        <option value="current">현재 브랜치</option>
      </select>
    </label>
    <label>
      <span>터미널</span>
      <select bind:value={s.terminal} onchange={save}>
        <option value="auto">자동 (Windows Terminal → PowerShell)</option>
        <option value="wt">Windows Terminal</option>
        <option value="powershell">PowerShell</option>
        <option value="git-bash">Git Bash</option>
      </select>
    </label>
    <label>
      <span>편집기</span>
      <input type="text" bind:value={s.editor} onchange={save} placeholder="비우면 VS Code(code) → 기본 프로그램" />
      <small>예: C:\Program Files\JetBrains\IntelliJ IDEA\bin\idea64.exe</small>
    </label>
    <div class="info">
      <div class="ver">
        <span>버전</span>NanoGit {app.info?.version ?? ''}
        {#if app.update}<button class="ghost" onclick={() => void app.installUpdate()}><Icon name="pull" size={12} />{app.update.version}로 업데이트</button>{/if}
        <button class="ghost" disabled={checking || app.updateProgress !== null} onclick={checkNow}><Icon name="refresh" size={12} />{checking ? '확인 중…' : '업데이트 확인'}</button>
        <label class="chk"><input type="checkbox" bind:checked={s.autoUpdate} onchange={save} />자동 확인 (켤 때·6시간마다)</label>
      </div>
      <div class="ver">
        <span>바로가기</span>
        <button class="ghost" onclick={() => void app.makeUpdateShortcut()} title="누르면 바로 새 버전을 받아 설치하는 바로가기 (처음 켤 때 한 번 만들어 둡니다)"
          ><Icon name="pull" size={12} />바탕화면에 "NanoGit 업데이트" 만들기</button
        >
      </div>
      <div><span>git</span>{app.info?.gitVersion ?? app.info?.gitError ?? ''} <span class="muted">{app.info?.gitPath ?? ''}</span></div>
      <div><span>설정 폴더</span>{app.info?.dataDir ?? ''}</div>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(0 0 0 / 0.3);
  }
  .dlg {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 81;
    width: min(560px, 92vw);
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
    gap: 14px;
    padding: 16px;
  }
  label {
    display: grid;
    grid-template-columns: 130px 1fr;
    align-items: center;
    gap: 4px 12px;
  }
  label small,
  .checks small,
  .test small {
    grid-column: 2;
    color: var(--muted);
    font-size: 11.5px;
  }
  .row {
    display: grid;
    grid-template-columns: 130px 1fr;
    align-items: start;
    gap: 4px 12px;
  }
  .checks {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .sub {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 22px;
  }
  .sub.off {
    opacity: 0.5;
  }
  label.chk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .test {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 2px;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--border-strong);
    font-size: 12px;
    user-select: text;
  }
  .ver {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ver .chk {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .info span:first-child {
    display: inline-block;
    width: 130px;
    color: var(--muted);
  }
</style>
