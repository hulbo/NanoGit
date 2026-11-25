<script lang="ts">
  // 파일 이력 (강화): 이름 변경 추적, 커밋별 변경, 두 버전 비교, 그 버전 내용, blame, 작업 트리와 비교, 선택한 줄의 이력.
  // 파일 상태에서 바뀐 파일이면 맨 위에 "커밋하지 않은 변경 (지금 파일)"을 따로 보인다 (이력과 함께 지금 상태도 보도록)
  import { errorMessage } from '../api'
  import { parseDiff, unifiedRows, type UnifiedRow } from '../diff'
  import { highlightDiff } from '../highlight'
  import { basename, dateTime, initial, nameHue, shortDate, short } from '../format'
  import { commitMenu, fileMenu } from '../menus'
  import { untrack } from 'svelte'
  import { app, type Repo } from '../state.svelte'
  import type { Blame, CommitDetail, DiffTarget, HistoryEntry, LineHistoryEntry, TextBlob, WorkFile } from '../types'
  import CodeText from './CodeText.svelte'
  import CodeView, { type BlameCell } from './CodeView.svelte'
  import DiffView from './DiffView.svelte'
  import FileList from './FileList.svelte'
  import Icon from './Icon.svelte'
  import Split from './Split.svelte'

  let { repo }: { repo: Repo } = $props()

  type Tab = 'diff' | 'content' | 'blame' | 'worktree'
  const PAGE = 300
  /** 맨 위 "커밋하지 않은 변경" 줄의 표시 (커밋 해시 자리) */
  const WT = 'worktree'

  const target = $derived(repo.fileHistory)
  let follow = $state(true)
  let entries = $state.raw<HistoryEntry[]>([])
  let done = $state(false)
  let loading = $state(false)
  let listError = $state<string | null>(null)
  let filter = $state('')
  /** 고른 커밋 (최대 2개, Ctrl+클릭) */
  let picks = $state<string[]>([])
  let tab = $state<Tab>('diff')

  let blob = $state<TextBlob | null>(null)
  let content = $state<TextBlob | null>(null)
  let blame = $state<Blame | null>(null)
  let viewError = $state<string | null>(null)
  let viewLoading = $state(false)
  let detail = $state<CommitDetail | null>(null)
  let range = $state<[number, number] | null>(null)
  let lineHist = $state<{ range: [number, number]; path: string; list: LineHistoryEntry[] } | null>(null)
  let lineLoading = $state(false)
  /** 이 줄로 가서 골라 둔다 (내용으로 찾기에서 열었을 때) */
  let pendingLine: number | null = null
  let scrollLine = $state<number | null>(null)
  let seq = 0
  let lseq = 0

  // 대상 파일이 바뀌면 처음부터 읽는다
  $effect(() => {
    const t = target
    void follow
    if (!t) return
    tab = t.line ? 'content' : (t.tab ?? 'diff')
    pendingLine = t.line ?? null
    scrollLine = null
    picks = []
    entries = []
    lineHist = null
    range = null
    void load(true, t.rev ?? null)
  })

  async function load(reset: boolean, want: string | null = null) {
    const t = target
    if (!t) return
    const my = ++lseq
    loading = true
    listError = null
    try {
      const list = await app.backend.fileHistory(repo.root, t.path, follow, reset ? 0 : entries.length, PAGE)
      if (my !== lseq) return
      entries = reset ? list : [...entries, ...list]
      done = list.length < PAGE
      if (reset) {
        // 정한 커밋 → 커밋하지 않은 변경(있으면) → 마지막 커밋
        const first = want ? list.find((e) => e.commit.sha === want) : null
        picks = first ? [first.commit.sha] : work ? [WT] : list[0] ? [list[0].commit.sha] : []
        if (picks[0] === WT && tab === 'worktree') tab = 'diff'
      }
    } catch (e) {
      if (my === lseq) listError = errorMessage(e)
    } finally {
      if (my === lseq) loading = false
    }
  }

  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.commit.subject.toLowerCase().includes(q) || e.commit.author.toLowerCase().includes(q) || e.commit.sha.startsWith(q))
  })

  const currentPath = $derived(entries[0]?.path ?? target?.path ?? '')

  /** 아직 커밋하지 않은 지금 파일: 파일 상태(스테이지·작업 트리·충돌)에 이 파일이 있으면 */
  const work = $derived.by(() => {
    const s = repo.status
    const p = currentPath
    if (!s || !p) return null
    const same = (f: WorkFile) => f.path === p
    const conflicted = s.conflicted.find(same)
    const unstaged = s.unstaged.find(same)
    const staged = s.staged.find(same)
    const f = conflicted ?? unstaged ?? staged
    if (!f) return null
    const mtime = Math.max(0, ...[conflicted, unstaged, staged].map((x) => x?.mtime ?? 0))
    return { path: p, status: f.status, staged: !!staged, unstaged: !!unstaged, conflicted: !!conflicted, mtime }
  })
  /** 맨 위 줄로 쓰는 이력 항목 (커밋 해시 자리에 WT) */
  const workEntry = $derived<HistoryEntry | null>(
    work
      ? {
          commit: { sha: WT, parents: [], author: '', email: '', time: Math.floor(work.mtime / 1000), subject: '커밋하지 않은 변경 (지금 파일)', refs: [] },
          path: work.path,
          oldPath: null,
          status: work.status,
          additions: null,
          deletions: null,
        }
      : null,
  )
  const all = $derived(workEntry ? [workEntry, ...entries] : entries)
  const isWork = (h: HistoryEntry | null | undefined) => h?.commit.sha === WT
  const workText = $derived(
    work ? [work.conflicted && '충돌', work.staged && '스테이지됨', work.unstaged && (work.status === '?' ? '새 파일' : '작업 트리에서 수정')].filter(Boolean).join(' · ') : '',
  )

  const selected = $derived(picks.map((s) => all.find((e) => e.commit.sha === s)).filter((e): e is HistoryEntry => !!e))
  /** 두 개를 고르면 오래된 것 → 최근 것 (커밋하지 않은 변경이 가장 최근) */
  const pair = $derived.by(() => {
    if (selected.length !== 2) return null
    const [a, b] = selected
    const ia = all.indexOf(a)
    const ib = all.indexOf(b)
    return ia > ib ? { older: a, newer: b } : { older: b, newer: a }
  })
  const one = $derived(selected.length === 1 ? selected[0] : null)

  // 커밋하지 않은 변경이 없어지면(커밋·버리기) 그 줄을 고른 것도 풀고, 새 커밋이 생기면 목록을 다시 읽는다
  $effect(() => {
    if (picks.includes(WT) && !work && entries.length) picks = [entries[0].commit.sha]
  })
  let lastHead: string | null = null
  $effect(() => {
    const head = repo.status?.head ?? null
    if (lastHead && head && head !== lastHead) {
      untrack(() => {
        const keep = picks.find((p) => p !== WT) ?? null
        void load(true, keep)
      })
    }
    lastHead = head
  })

  function click(e: MouseEvent, h: HistoryEntry) {
    const sha = h.commit.sha
    if (e.ctrlKey || e.metaKey) {
      if (picks.includes(sha)) picks = picks.filter((p) => p !== sha)
      else picks = [...picks.slice(-1), sha]
      if (picks.length === 2) tab = 'diff'
    } else {
      picks = [sha]
      if (sha === WT && tab === 'worktree') tab = 'diff'
    }
  }

  /** 커밋하지 않은 변경: 마지막 커밋 → 지금 파일 (커밋된 적 없는 새 파일이면 전체가 추가) */
  function workDiff(h: HistoryEntry): DiffTarget {
    const isNew = !entries.length || h.status === '?' || h.status === 'A'
    return isNew ? { kind: 'worktree', path: h.path, untracked: true } : { kind: 'revToWorktree', rev: 'HEAD', revPath: h.path, path: h.path }
  }

  // 오른쪽 보기 읽기. 커밋하지 않은 변경을 보고 있으면 파일이 바뀔 때마다 (보던 자리 그대로) 다시 읽는다
  const viewKey = $derived(`${tab}|${picks.join(',')}|${app.settings.ignoreWhitespace}|${entries.length > 0}`)
  const liveKey = $derived(picks.includes(WT) && work ? `${work.mtime}|${work.status}|${work.staged}|${work.unstaged}|${repo.indexSeq}` : '')
  let lastKey = ''
  $effect(() => {
    void liveKey
    const key = viewKey
    const t = tab
    const p = pair
    const o = one
    const opts = { ignoreWhitespace: app.settings.ignoreWhitespace }
    const my = ++seq
    const fresh = key !== lastKey
    lastKey = key
    if (fresh) {
      blob = null
      content = null
      blame = null
      viewError = null
      range = null
    }
    if (!target) return
    /** 커밋이면 그 해시, 지금 파일이면 null */
    const revOf = (h: HistoryEntry | null) => (h && !isWork(h) ? h.commit.sha : null)
    let job: Promise<unknown> | null = null
    if (t === 'diff' || t === 'worktree') {
      let dt: DiffTarget | null = null
      if (t === 'diff' && p && isWork(p.newer)) dt = { kind: 'revToWorktree', rev: p.older.commit.sha, revPath: p.older.path, path: p.newer.path }
      else if (t === 'diff' && p) dt = { kind: 'blobs', aRev: p.older.commit.sha, aPath: p.older.path, bRev: p.newer.commit.sha, bPath: p.newer.path }
      else if (t === 'diff' && o && isWork(o)) dt = workDiff(o)
      else if (t === 'diff' && o) dt = { kind: 'commit', sha: o.commit.sha, path: o.path, oldPath: o.oldPath }
      else if (t === 'worktree' && o && !isWork(o)) dt = { kind: 'revToWorktree', rev: o.commit.sha, revPath: o.path, path: currentPath }
      if (dt) job = app.backend.diff(repo.root, dt, opts).then((b) => my === seq && (blob = b))
    } else if (t === 'content') {
      const path = o ? o.path : target.path
      job = app.backend.fileContent(repo.root, path, revOf(o)).then((b) => {
        if (my !== seq) return
        content = b
        // 내용으로 찾기에서 열었으면 그 줄을 골라 보인다
        if (pendingLine) {
          range = [pendingLine, pendingLine]
          scrollLine = pendingLine
          pendingLine = null
        }
      })
    } else if (t === 'blame') {
      const path = o ? o.path : target.path
      job = app.backend.blame(repo.root, path, revOf(o)).then((b) => my === seq && (blame = b))
    }
    if (!job) return
    if (fresh) viewLoading = true
    job
      .catch((e) => my === seq && (viewError = errorMessage(e)))
      .finally(() => my === seq && (viewLoading = false))
  })

  // 고른 커밋의 정보와 같이 바뀐 파일
  $effect(() => {
    const o = one
    detail = null
    if (!o || isWork(o)) return
    const sha = o.commit.sha
    app.backend
      .commit(repo.root, sha)
      .then((d) => {
        if (one?.commit.sha === sha) detail = d
      })
      .catch(() => {})
  })

  const blameCells = $derived.by((): BlameCell[] | null => {
    if (!blame) return null
    const times = blame.commits.map((c) => c.time).filter((t) => t > 0)
    const min = Math.min(...times)
    const max = Math.max(...times)
    return blame.lines.map((l, i) => {
      const c = blame!.commits[l.c]
      return {
        sha: c.sha,
        author: c.author,
        time: c.time,
        summary: c.summary,
        first: i === 0 || blame!.lines[i - 1].c !== l.c,
        age: max > min ? (c.time - min) / (max - min) : 1,
      }
    })
  })
  const blameLines = $derived(blame ? blame.lines.map((l) => l.text) : [])
  /** 선택한 줄 이력의 diff (구문 강조 포함) */
  function lineRows(diff: string): UnifiedRow[] {
    const files = parseDiff(diff)
    highlightDiff(files)
    return unifiedRows(files, false).filter((r) => r.kind !== 'hunk')
  }
  const contentLines = $derived(content && !content.binary ? content.text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [])

  async function lineHistory() {
    if (!range || !target) return
    const o = one
    const path = o ? o.path : target.path
    const r = range
    lineLoading = true
    try {
      const list = await app.backend.lineHistory(repo.root, path, r[0], r[1], o && !isWork(o) ? o.commit.sha : null)
      lineHist = { range: r, path, list }
    } catch (e) {
      app.toast(errorMessage(e), 'error')
    } finally {
      lineLoading = false
    }
  }

  function jumpTo(sha: string) {
    if (/^0+$/.test(sha)) return
    if (sha !== WT && entries.some((e) => e.commit.sha === sha)) {
      picks = [sha]
      tab = 'diff'
    } else void repo.reveal(sha)
  }

  const TABS: [Tab, string, string][] = [
    ['diff', '변경 내용', 'compare'],
    ['content', '이 버전 내용', 'eye'],
    ['blame', 'Blame', 'blame'],
    ['worktree', '작업 트리와 비교', 'files'],
  ]
</script>

{#if !target}
  <div class="empty">파일을 우클릭해 "이력 조회"를 고르세요</div>
{:else}
  <div class="fh">
    <div class="pane-head head">
      <button class="ghost" title="이전 화면" onclick={() => repo.setView('history')}><Icon name="back" size={14} /></button>
      <Icon name="history" size={15} />
      <span class="title">파일 이력</span>
      <span class="path mono" title={target.path}>{target.path}</span>
      <button class="ghost" title="경로 복사" onclick={() => app.copy(target.path, '경로')}><Icon name="copy" size={13} /></button>
      <span class="grow"></span>
      <label class="chk" title="이름이 바뀌기 전의 이력까지 따라갑니다 (git log --follow)"><input type="checkbox" bind:checked={follow} />이름 변경 따라가기</label>
      <div class="search">
        <Icon name="search" size={13} />
        <input type="search" placeholder="메시지·작성자·해시" bind:value={filter} />
      </div>
    </div>
    <div class="main">
      <Split key="filehistory" initial={0.34} min={260}>
        {#snippet a()}
          <Split dir="v" key="filehistory-left" initial={0.62} min={100}>
            {#snippet a()}
              <div class="list">
                <div class="hint muted">커밋 {entries.length}{done ? '' : '+'}개 · Ctrl+클릭으로 두 버전 비교</div>
                {#if listError}<div class="empty err">{listError}</div>{/if}
                {#if workEntry && work}
                  <button
                    class="hrow work"
                    class:sel={picks.includes(WT)}
                    title="아직 커밋하지 않은 지금 파일입니다. 변경 내용은 마지막 커밋 → 지금 파일"
                    onclick={(e) => click(e, workEntry)}
                    oncontextmenu={(e) => {
                      if (!picks.includes(WT)) picks = [WT]
                      app.openMenu(e, fileMenu(repo, { path: work.path, deleted: work.status === 'D' }))
                    }}
                  >
                    <span class="wicon"><Icon name="editor" size={13} /></span>
                    <span class="body">
                      <span class="l1">
                        <span class="st st-{work.status}">{work.status}</span>
                        <span class="subj">커밋하지 않은 변경 (지금 파일)</span>
                      </span>
                      <span class="l2">{workText}{work.mtime ? ` · ${shortDate(work.mtime / 1000)} 저장` : ''}</span>
                    </span>
                    {#if picks.length === 2 && picks.includes(WT)}
                      <span class="ab">B</span>
                    {/if}
                  </button>
                {/if}
                {#each shown as h (h.commit.sha)}
                  <button
                    class="hrow"
                    class:sel={picks.includes(h.commit.sha)}
                    onclick={(e) => click(e, h)}
                    oncontextmenu={(e) => {
                      if (!picks.includes(h.commit.sha)) picks = [h.commit.sha]
                      app.openMenu(e, [...commitMenu(repo, h.commit.sha, h.commit.subject), 'separator', ...fileMenu(repo, { path: h.path, rev: h.commit.sha, deleted: h.status === 'D' })])
                    }}
                  >
                    <span class="avatar" style="background:hsl({nameHue(h.commit.author)} 45% 45%)">{initial(h.commit.author)}</span>
                    <span class="body">
                      <span class="l1">
                        {#if h.status}<span class="st st-{h.status}">{h.status}</span>{/if}
                        <span class="subj">{h.commit.subject}</span>
                      </span>
                      <span class="l2">
                        <span class="mono">{short(h.commit.sha)}</span> · {h.commit.author} · {shortDate(h.commit.time)}
                        {#if h.additions != null}<span class="add-n">+{h.additions}</span> <span class="del-n">-{h.deletions}</span>{/if}
                      </span>
                      {#if h.oldPath && h.oldPath !== h.path}
                        <span class="l3">이름 변경: {h.oldPath} → {h.path}</span>
                      {:else if h.path !== currentPath}
                        <span class="l3">그때 경로: {h.path}</span>
                      {/if}
                    </span>
                    {#if picks.length === 2 && picks.includes(h.commit.sha)}
                      <span class="ab">{pair?.older === h ? 'A' : 'B'}</span>
                    {/if}
                  </button>
                {/each}
                {#if !done && entries.length && !filter}
                  <button class="ghost more" disabled={loading} onclick={() => load(false)}>{loading ? '불러오는 중…' : '더 보기'}</button>
                {:else if loading && !entries.length}
                  <div class="empty">불러오는 중…</div>
                {:else if !entries.length}
                  <div class="empty">이 파일을 바꾼 커밋이 없습니다 (아직 커밋하지 않은 새 파일일 수 있습니다)</div>
                {/if}
              </div>
            {/snippet}
            {#snippet b()}
              <div class="info">
                {#if one && isWork(one) && work}
                  <div class="msg">
                    <b>커밋하지 않은 변경 (지금 파일)</b>
                    <div class="muted small">{workText}{work.mtime ? ` · 마지막 저장 ${dateTime(work.mtime / 1000, true)}` : ''}</div>
                    <div class="muted small">
                      변경 내용: 마지막 커밋 → 지금 파일 · 이 버전 내용·Blame: 지금 파일. 파일이 바뀌면 바로 다시 읽습니다.
                    </div>
                  </div>
                {:else if detail}
                  <div class="msg">
                    <b>{detail.message.split('\n')[0]}</b>
                    <div class="muted small">{detail.author} · {dateTime(detail.time, true)} · <span class="mono">{short(detail.sha, 10)}</span></div>
                    {#if detail.message.includes('\n')}<pre>{detail.message.split('\n').slice(1).join('\n').trim()}</pre>{/if}
                  </div>
                  <div class="pane-head sub"><span class="title">같이 바뀐 파일 {detail.files.length}</span><span class="muted small">더블클릭: 그 파일의 이력</span></div>
                  <FileList
                    files={detail.files}
                    selected={one?.path ?? null}
                    onselect={() => {}}
                    ondblclick={(f) => repo.openFileHistory({ path: f.path, rev: detail!.sha })}
                    oncontext={(e, f) => app.openMenu(e, fileMenu(repo, { path: f.path, rev: detail!.sha, deleted: f.status === 'D' }))}
                  />
                {:else if pair}
                  <div class="msg">
                    <div><span class="ab">A</span> {pair.older.commit.subject} <span class="mono muted">{short(pair.older.commit.sha)}</span></div>
                    <div><span class="ab">B</span> {pair.newer.commit.subject} {#if !isWork(pair.newer)}<span class="mono muted">{short(pair.newer.commit.sha)}</span>{/if}</div>
                    <div class="muted small">A의 {basename(pair.older.path)} → B의 {basename(pair.newer.path)} 비교</div>
                  </div>
                {:else}
                  <div class="empty">커밋을 고르세요</div>
                {/if}
              </div>
            {/snippet}
          </Split>
        {/snippet}
        {#snippet b()}
          <div class="right">
            <div class="tabs">
              {#each TABS as [t, label, icon] (t)}
                <button class:on={tab === t} disabled={(t !== 'diff' && !!pair) || (t === 'worktree' && isWork(one))} onclick={() => (tab = t)}>
                  <Icon name={icon as 'compare'} size={13} />{t === 'diff' && pair ? '두 버전 비교 (A → B)' : label}
                </button>
              {/each}
              <span class="grow"></span>
              {#if (tab === 'content' || tab === 'blame') && range}
                <button class="ghost on" disabled={lineLoading} onclick={lineHistory} title="git log -L: 선택한 줄만의 변경 이력">
                  <Icon name="lines" size={13} />{lineLoading ? '찾는 중…' : `선택한 줄 이력 (${range[0]}${range[1] !== range[0] ? `-${range[1]}` : ''}줄)`}
                </button>
              {:else if tab === 'content' || tab === 'blame'}
                <span class="muted small">줄 번호를 끌어 고르면 그 줄만의 이력을 봅니다</span>
              {/if}
            </div>
            <div class="view">
              {#if lineHist}
                <div class="lh">
                  <div class="pane-head">
                    <span class="title">{lineHist.path} {lineHist.range[0]}-{lineHist.range[1]}줄의 이력 · 커밋 {lineHist.list.length}개</span>
                    <span class="grow"></span>
                    <button class="ghost" onclick={() => (lineHist = null)}><Icon name="x" size={13} />닫기</button>
                  </div>
                  <div class="lh-list">
                    {#each lineHist.list as l (l.commit.sha)}
                      <div class="lh-item">
                        <button class="lh-head" onclick={() => jumpTo(l.commit.sha)}>
                          <span class="mono">{short(l.commit.sha)}</span>
                          <b>{l.commit.subject}</b>
                          <span class="muted">{l.commit.author} · {shortDate(l.commit.time)}</span>
                        </button>
                        <div class="lh-diff mono">
                          {#each lineRows(l.diff) as r, i (i)}
                            <div class="ln {r.kind}"><span class="lno">{r.new ?? r.old ?? ''}</span>{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}<CodeText text={r.text} toks={r.toks} /></div>
                          {/each}
                        </div>
                      </div>
                    {:else}
                      <div class="empty">기록이 없습니다</div>
                    {/each}
                  </div>
                </div>
              {:else if tab === 'diff' || tab === 'worktree'}
                <DiffView
                  {blob}
                  loading={viewLoading}
                  error={viewError}
                  title={pair
                    ? `A ${short(pair.older.commit.sha)}:${pair.older.path} → B ${isWork(pair.newer) ? '지금 파일' : `${short(pair.newer.commit.sha)}:${pair.newer.path}`}`
                    : one && isWork(one)
                      ? `마지막 커밋 → 지금 파일 · ${one.path}`
                      : one
                        ? tab === 'worktree'
                          ? `${short(one.commit.sha)}:${one.path} → 작업 트리 ${currentPath}`
                          : `${short(one.commit.sha)} · ${one.path}`
                        : ''}
                  emptyText={tab === 'worktree' ? '커밋을 하나 고르면 지금 파일과 비교합니다' : '커밋을 고르세요'}
                />
              {:else if viewError}
                <div class="empty err">{viewError}</div>
              {:else if viewLoading}
                <div class="empty">불러오는 중…</div>
              {:else if tab === 'content' && content}
                {#if content.binary}
                  <div class="empty">이진 파일입니다 ({content.size.toLocaleString()} 바이트)</div>
                {:else}
                  <CodeView lines={contentLines} path={one ? one.path : target.path} {range} scrollTo={scrollLine} onrange={(r) => (range = r)} />
                {/if}
              {:else if tab === 'blame' && blame}
                <CodeView lines={blameLines} path={one ? one.path : target.path} blame={blameCells} {range} onrange={(r) => (range = r)} onblame={jumpTo} />
              {/if}
            </div>
          </div>
        {/snippet}
      </Split>
    </div>
  </div>
{/if}

<style>
  .fh {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .head .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent-text);
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .search input {
    width: 180px;
  }
  .main {
    flex: 1;
    min-height: 0;
  }
  .list {
    height: 100%;
    overflow: auto;
  }
  .hint {
    padding: 4px 10px;
    font-size: 11.5px;
    border-bottom: 1px solid var(--border);
  }
  .hrow {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text);
    text-align: left;
    cursor: default;
  }
  .hrow:hover {
    background: var(--hover);
  }
  .hrow.sel {
    background: var(--sel);
  }
  /* 커밋하지 않은 지금 파일: 커밋 줄과 다르게 (점선 테두리, 왼쪽 띠, 연필) */
  .hrow.work {
    border-left: 3px solid var(--st-modified);
    border-bottom: 1px dashed var(--border-strong);
    background: color-mix(in srgb, var(--st-modified) 7%, transparent);
  }
  .hrow.work.sel {
    background: color-mix(in srgb, var(--st-modified) 16%, var(--sel));
  }
  .hrow.work .subj {
    color: var(--st-modified);
    font-weight: 600;
  }
  .wicon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    border: 1px dashed var(--st-modified);
    border-radius: 50%;
    color: var(--st-modified);
    flex: none;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    border-radius: 50%;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    flex: none;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .l1 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .subj {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .l2 {
    color: var(--muted);
    font-size: 11.5px;
  }
  .l3 {
    color: var(--st-renamed);
    font-size: 11.5px;
  }
  .ab {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    flex: none;
  }
  .more {
    margin: 8px auto;
    display: flex;
  }
  .info {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
  }
  .msg {
    padding: 8px 10px;
    user-select: text;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .msg pre {
    margin: 4px 0 0;
    font-family: var(--font-ui);
    white-space: pre-wrap;
    color: var(--text-2);
  }
  .small {
    font-size: 11.5px;
  }
  .sub {
    height: 28px;
  }
  .right {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 34px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border-strong);
    background: var(--panel);
    flex: none;
  }
  .tabs > button:not(.ghost) {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text-2);
    cursor: pointer;
  }
  .tabs > button:not(.ghost):hover:not(:disabled) {
    background: var(--hover);
  }
  .tabs > button.on {
    background: var(--sel);
    color: var(--text);
  }
  .tabs > button:disabled {
    color: var(--faint);
    cursor: default;
  }
  .tabs .grow {
    flex: 1;
  }
  .view {
    flex: 1;
    min-height: 0;
  }
  .err {
    color: var(--err);
    white-space: pre-wrap;
    user-select: text;
  }
  .lh {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .lh-list {
    flex: 1;
    overflow: auto;
    padding: 8px;
  }
  .lh-item {
    margin-bottom: 10px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    overflow: hidden;
  }
  .lh-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    background: var(--panel);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .lh-head:hover b {
    text-decoration: underline;
  }
  .lh-diff {
    font-size: var(--code-size);
    overflow-x: auto;
    user-select: text;
  }
  .ln {
    white-space: pre;
    line-height: 19px;
    padding-right: 12px;
  }
  .ln.add {
    background: var(--diff-add-bg);
  }
  .ln.del {
    background: var(--diff-del-bg);
  }
  .ln.meta,
  .ln.file {
    display: none;
  }
  .lno {
    display: inline-block;
    width: 44px;
    padding-right: 8px;
    color: var(--diff-gutter);
    text-align: right;
    user-select: none;
  }
</style>
