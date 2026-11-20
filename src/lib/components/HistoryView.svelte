<script lang="ts">
  // 히스토리: 그래프 + 커밋 목록(가상 스크롤) + 아래 커밋 상세
  import { computeGraph } from '../graph'
  import { shortDate, short } from '../format'
  import { commitMenu } from '../menus'
  import { app, type Repo } from '../state.svelte'
  import CommitPanel from './CommitPanel.svelte'
  import GraphCell from './GraphCell.svelte'
  import Icon from './Icon.svelte'
  import Refs from './Refs.svelte'
  import Split from './Split.svelte'

  let { repo }: { repo: Repo } = $props()

  const ROW = 24
  const LANE = 14
  const graph = $derived(computeGraph(repo.commits))
  const graphWidth = $derived(Math.max(56, Math.min(16, Math.max(1, ...graph.map((g) => g.width))) * LANE + 8))
  const unpushed = $derived(repo.unpushed)
  const changes = $derived(repo.changeCount)
  /** 맨 위 "커밋하지 않은 변경" 행 */
  const pseudo = $derived(changes > 0 && !repo.search ? 1 : 0)
  const total = $derived(repo.commits.length + pseudo)

  let scroller: HTMLDivElement | undefined = $state()
  let scrollTop = $state(0)
  let height = $state(300)
  // 입력란 값 (입력이 멈추면 repo.search에 넣는다). 탭이 바뀌면 화면이 새로 만들어진다
  // svelte-ignore state_referenced_locally
  let searchText = $state(repo.search)
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 10))
  const end = $derived(Math.min(total, Math.ceil((scrollTop + height) / ROW) + 10))
  const now = Date.now()

  function onscroll(e: Event) {
    const el = e.currentTarget as HTMLDivElement
    scrollTop = el.scrollTop
    if (el.scrollTop + el.clientHeight > el.scrollHeight - ROW * 40) void repo.loadMore()
  }

  function setScope(s: 'all' | 'current') {
    repo.scope = s
    app.settings.historyScope = s
    void app.persist()
    void repo.loadLog(true)
  }

  function onsearch() {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      repo.search = searchText
      void repo.loadLog(true)
    }, 300)
  }

  function select(i: number) {
    const c = repo.commits[i - pseudo]
    if (c) repo.selected = c.sha
  }

  function onkey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'PageDown' && e.key !== 'PageUp') return
    e.preventDefault()
    const i = repo.commits.findIndex((c) => c.sha === repo.selected) + pseudo
    const step = e.key === 'PageDown' || e.key === 'PageUp' ? Math.floor(height / ROW) : 1
    const dir = e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : -1
    const next = Math.max(pseudo, Math.min(total - 1, i + dir * step))
    select(next)
    if (scroller) {
      const top = next * ROW
      if (top < scroller.scrollTop) scroller.scrollTop = top
      else if (top + ROW > scroller.scrollTop + height) scroller.scrollTop = top + ROW - height
    }
  }

  // 다른 곳에서 커밋으로 이동하면(reveal) 보이게 스크롤한다
  $effect(() => {
    const sha = repo.selected
    if (!sha || !scroller) return
    const i = repo.commits.findIndex((c) => c.sha === sha)
    if (i === -1) return
    const top = (i + pseudo) * ROW
    const el = scroller
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3)
  })
</script>

<Split dir="v" key="history" initial={0.55} min={140}>
  {#snippet a()}
    <div class="top">
      <div class="pane-head">
        <div class="seg">
          <button class:on={repo.scope === 'all'} onclick={() => setScope('all')}>모든 브랜치</button>
          <button class:on={repo.scope === 'current'} onclick={() => setScope('current')}>현재 브랜치</button>
        </div>
        <span class="grow"></span>
        {#if repo.logLoading}<span class="muted small">불러오는 중…</span>{/if}
        <div class="search">
          <Icon name="search" size={13} />
          <input type="search" placeholder="커밋 메시지 검색" bind:value={searchText} oninput={onsearch} />
        </div>
      </div>
      <div class="cols" style="--gw:{graphWidth}px">
        <span>그래프</span><span>설명</span><span>날짜</span><span>작성자</span><span>커밋</span>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="list" bind:this={scroller} bind:clientHeight={height} {onscroll} onkeydown={onkey} tabindex="0" role="grid">
        <div class="spacer" style="height:{total * ROW}px; --gw:{graphWidth}px">
          <div style="transform:translateY({start * ROW}px)">
            {#each Array.from({ length: end - start }, (_, k) => start + k) as i (i < pseudo ? 'wip' : repo.commits[i - pseudo].sha)}
              {#if i < pseudo}
                <button class="row wip" onclick={() => repo.setView('status')}>
                  <span class="g"><svg width={LANE} height={ROW}><circle cx={LANE / 2} cy={ROW / 2} r="4.5" fill="none" stroke="var(--warn)" stroke-width="2" stroke-dasharray="2 2" /></svg></span>
                  <span class="desc"><b>커밋하지 않은 변경 {changes}개</b> <span class="muted">— 눌러서 파일 상태 보기</span></span>
                  <span></span><span></span><span></span>
                </button>
              {:else}
                {@const c = repo.commits[i - pseudo]}
                {@const up = unpushed.has(c.sha)}
                <button
                  class="row"
                  class:sel={repo.selected === c.sha}
                  class:merge={c.parents.length > 1}
                  onclick={() => (repo.selected = c.sha)}
                  oncontextmenu={(e) => {
                    repo.selected = c.sha
                    app.openMenu(e, commitMenu(repo, c.sha, c.subject))
                  }}
                >
                  <span class="g"><GraphCell row={graph[i - pseudo]} height={ROW} lane={LANE} unpushed={up} /></span>
                  <span class="desc" title={c.subject}>
                    {#if up}<span class="up" title="아직 push하지 않은 커밋">↑</span>{/if}
                    <Refs refs={c.refs} />{c.subject}
                  </span>
                  <span class="date" title={new Date(c.time * 1000).toLocaleString('ko-KR')}>{shortDate(c.time, now)}</span>
                  <span class="author" title={c.email}>{c.author}</span>
                  <span class="sha mono">{short(c.sha)}</span>
                </button>
              {/if}
            {/each}
          </div>
        </div>
        {#if !repo.commits.length && !repo.logLoading}
          <div class="empty">{repo.search ? '찾는 커밋이 없습니다' : '커밋이 없습니다'}</div>
        {/if}
      </div>
    </div>
  {/snippet}
  {#snippet b()}
    <CommitPanel {repo} sha={repo.selected} key="history" />
  {/snippet}
</Split>

<style>
  .top {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .small {
    font-size: 12px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .search input {
    width: 220px;
  }
  .cols,
  .row {
    display: grid;
    grid-template-columns: var(--gw) minmax(200px, 1fr) 120px 130px 74px;
    align-items: center;
  }
  .cols {
    height: 24px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 12px;
    flex: none;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    outline: none;
    position: relative;
  }
  .spacer {
    position: relative;
  }
  .row {
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
  .row.merge .desc {
    color: var(--text-2);
  }
  .g {
    overflow: hidden;
  }
  .desc,
  .date,
  .author {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 10px;
  }
  .date,
  .author {
    color: var(--text-2);
    font-size: 12.5px;
  }
  .sha {
    color: var(--muted);
    font-size: 12px;
  }
  .up {
    margin-right: 4px;
    color: var(--warn);
    font-weight: 700;
  }
  .wip {
    color: var(--warn);
  }
  .empty {
    position: absolute;
    inset: 0;
    height: auto;
  }
</style>
