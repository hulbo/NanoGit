<script lang="ts">
  // Push 대기: 아직 push하지 않은 커밋과 바뀐 파일 (IntelliJ push 대화상자처럼)
  import { errorMessage } from '../api'
  import { shortDate, short } from '../format'
  import { commitMenu, fileMenu } from '../menus'
  import { app, type Repo } from '../state.svelte'
  import type { FileChange, OutgoingBranch, TextBlob } from '../types'
  import DiffView from './DiffView.svelte'
  import FileList from './FileList.svelte'
  import Icon from './Icon.svelte'
  import Split from './Split.svelte'

  let { repo }: { repo: Repo } = $props()

  let pick = $state<{ branch: string; sha: string | null } | null>(null)
  let files = $state<FileChange[]>([])
  let file = $state<FileChange | null>(null)
  let blob = $state<TextBlob | null>(null)
  let error = $state<string | null>(null)
  let loading = $state(false)
  let tree = $state(true)
  let fseq = 0
  let dseq = 0

  const list = $derived(repo.outgoing ?? [])
  const branch = $derived(pick ? (list.find((b) => b.branch === pick!.branch) ?? null) : null)
  const totalCommits = $derived(list.reduce((n, b) => n + b.commits.length, 0))

  // 처음엔 현재 브랜치 전체를 고른다. 고른 커밋이 사라지면(push됨) 다시 고른다
  $effect(() => {
    const b = branch
    if (b && (!pick?.sha || b.commits.some((c) => c.sha === pick!.sha))) return
    const first = list.find((x) => x.current) ?? list[0]
    pick = first ? { branch: first.branch, sha: null } : null
  })

  // 고른 것의 파일 목록
  $effect(() => {
    const p = pick
    const b = branch
    file = null
    if (!p || !b) {
      files = []
      return
    }
    if (!p.sha) {
      files = b.files
      file = b.files[0] ?? null
      return
    }
    const my = ++fseq
    files = []
    app.backend
      .commit(repo.root, p.sha)
      .then((d) => {
        if (my !== fseq) return
        files = d.files
        file = d.files[0] ?? null
      })
      .catch((e) => app.toast(errorMessage(e), 'error'))
  })

  $effect(() => {
    const f = file
    const p = pick
    const b = branch
    void app.settings.ignoreWhitespace
    blob = null
    error = null
    if (!f || !p || !b) return
    const my = ++dseq
    loading = true
    const target = p.sha
      ? ({ kind: 'commit', sha: p.sha, path: f.path, oldPath: f.oldPath } as const)
      : ({ kind: 'range', from: b.base, to: `refs/heads/${b.branch}`, path: f.path, oldPath: f.oldPath } as const)
    app.backend
      .diff(repo.root, target, { ignoreWhitespace: app.settings.ignoreWhitespace })
      .then((x) => {
        if (my === dseq) blob = x
      })
      .catch((e) => {
        if (my === dseq) error = errorMessage(e)
      })
      .finally(() => {
        if (my === dseq) loading = false
      })
  })

  function toggleAll() {
    repo.outgoingAll = !repo.outgoingAll
    void repo.refreshOutgoing()
  }

  const targetText = (b: OutgoingBranch) => (b.target ? `${b.branch} → ${b.target}` : `${b.branch} (원격 없음)`)
</script>

<div class="out">
  <div class="pane-head">
    <Icon name="push" size={15} />
    <span class="title">Push 대기</span>
    <span class="muted">커밋 {totalCommits}개</span>
    <span class="grow"></span>
    {#if repo.outgoingLoading}<span class="muted small">확인 중…</span>{/if}
    <button class="ghost" class:on={repo.outgoingAll} onclick={toggleAll}>모든 브랜치</button>
    <button class="ghost" title="원격 상태를 새로 가져와 다시 비교" onclick={() => app.fetch(repo)}><Icon name="fetch" size={14} />Fetch</button>
    <button class="ghost" title="다시 확인" onclick={() => repo.refreshOutgoing()}><Icon name="refresh" size={14} /></button>
  </div>
  <div class="main">
    <Split key="outgoing" initial={0.38} min={240}>
      {#snippet a()}
        <div class="commits">
          {#each list as b (b.branch)}
            <button class="brow" class:sel={pick?.branch === b.branch && !pick.sha} onclick={() => (pick = { branch: b.branch, sha: null })}>
              <Icon name="branch" size={14} />
              <span class="bname">{targetText(b)}</span>
              {#if b.current}<span class="cur">현재</span>{/if}
              <span class="count">{b.commits.length}{b.truncated ? '+' : ''}</span>
            </button>
            {#if b.newBranch && b.target}
              <div class="note info"><span>원격에 아직 없는 브랜치입니다. push하면 <b>{b.target}</b>이(가) 새로 생깁니다.</span></div>
            {/if}
            {#if !b.remote}
              <div class="note warn">원격 저장소가 없습니다.</div>
            {/if}
            {#if b.behind > 0}
              <div class="note warn"><Icon name="warning" size={13} /><span>원격에 내가 없는 커밋이 {b.behind}개 있습니다. 이대로 push하면 거부될 수 있습니다 (먼저 pull 필요).</span></div>
            {/if}
            {#each b.commits as c (c.sha)}
              <button
                class="crow"
                class:sel={pick?.sha === c.sha}
                onclick={() => (pick = { branch: b.branch, sha: c.sha })}
                oncontextmenu={(e) => app.openMenu(e, commitMenu(repo, c.sha, c.subject))}
                title={c.subject}
              >
                <span class="dot" class:merge={c.parents.length > 1}></span>
                <span class="subj">{c.subject}</span>
                <span class="meta">{c.author} · {shortDate(c.time)}</span>
                <span class="sha mono">{short(c.sha)}</span>
              </button>
            {:else}
              <div class="note ok"><Icon name="check" size={13} /><span>push할 커밋이 없습니다{b.target ? ` — ${b.target}와 같습니다` : ''}.</span></div>
            {/each}
          {:else}
            <div class="empty">{repo.outgoingLoading ? '확인 중…' : 'push할 커밋이 없습니다'}</div>
          {/each}
        </div>
      {/snippet}
      {#snippet b()}
        <Split dir="v" key="outgoing-files" initial={0.38} min={100}>
          {#snippet a()}
            <div class="files">
              <div class="pane-head">
                <span class="title">{pick?.sha ? `커밋 ${short(pick.sha)}의 변경` : '합친 변경'} · 파일 {files.length}</span>
                <span class="grow"></span>
                <div class="seg">
                  <button class:on={!tree} title="목록" onclick={() => (tree = false)}><Icon name="list" size={13} /></button>
                  <button class:on={tree} title="트리" onclick={() => (tree = true)}><Icon name="tree" size={13} /></button>
                </div>
              </div>
              <div class="scroll">
                <FileList
                  {files}
                  {tree}
                  selected={file?.path ?? null}
                  onselect={(f) => (file = files.find((x) => x.path === f.path) ?? null)}
                  oncontext={(e, f) => app.openMenu(e, fileMenu(repo, { path: f.path, rev: pick?.sha ?? (branch ? `refs/heads/${branch.branch}` : null), deleted: f.status === 'D' }))}
                  ondblclick={(f) => repo.openFileHistory({ path: f.path })}
                />
              </div>
            </div>
          {/snippet}
          {#snippet b()}
            <DiffView {blob} {loading} {error} title={file?.path ?? ''} emptyText="파일을 고르면 push될 변경이 보입니다" />
          {/snippet}
        </Split>
      {/snippet}
    </Split>
  </div>
</div>

<style>
  .out {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .main {
    flex: 1;
    min-height: 0;
  }
  .small {
    font-size: 12px;
  }
  .commits {
    height: 100%;
    overflow: auto;
    padding: 4px 0;
  }
  .brow,
  .crow {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: default;
  }
  .brow {
    height: 30px;
    padding: 0 10px;
    font-weight: 600;
  }
  .crow {
    height: 26px;
    padding: 0 10px 0 28px;
  }
  .brow:hover,
  .crow:hover {
    background: var(--hover);
  }
  .brow.sel,
  .crow.sel {
    background: var(--sel);
  }
  .bname,
  .subj {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cur {
    padding: 0 5px;
    border-radius: 4px;
    background: var(--ref-head);
    color: #fff;
    font-size: 10.5px;
  }
  .count {
    min-width: 22px;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--hover-strong);
    font-size: 11.5px;
    text-align: center;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px solid var(--lane-0);
    flex: none;
  }
  .dot.merge {
    border-color: var(--lane-3);
  }
  .meta {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .sha {
    color: var(--muted);
    font-size: 11.5px;
  }
  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 10px 4px 28px;
    padding: 5px 8px;
    border-radius: 5px;
    font-size: 12px;
    line-height: 1.4;
  }
  .note.info {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .note.warn {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }
  .note.ok {
    color: var(--ok);
  }
  .files {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
