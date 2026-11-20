<script lang="ts">
  // 커밋 정보 + 바뀐 파일 + diff (히스토리·활동 화면 아래쪽)
  import { errorMessage } from '../api'
  import { dateTime, initial, nameHue, short } from '../format'
  import { fileMenu } from '../menus'
  import { app, type Repo } from '../state.svelte'
  import type { CommitDetail, FileChange, TextBlob } from '../types'
  import DiffView from './DiffView.svelte'
  import FileList from './FileList.svelte'
  import Icon from './Icon.svelte'
  import Split from './Split.svelte'

  let { repo, sha, key = 'commit' }: { repo: Repo; sha: string | null; key?: string } = $props()

  let detail = $state<CommitDetail | null>(null)
  let error = $state<string | null>(null)
  let file = $state<FileChange | null>(null)
  let blob = $state<TextBlob | null>(null)
  let diffError = $state<string | null>(null)
  let diffLoading = $state(false)
  let branches = $state<string[] | null>(null)
  let tree = $state(false)
  let seq = 0
  let dseq = 0

  $effect(() => {
    const s = sha
    detail = null
    file = null
    blob = null
    branches = null
    error = null
    if (!s) return
    const my = ++seq
    app.backend
      .commit(repo.root, s)
      .then((d) => {
        if (my !== seq) return
        detail = d
        if (d.files.length) file = d.files[0]
      })
      .catch((e) => {
        if (my === seq) error = errorMessage(e)
      })
  })

  $effect(() => {
    const f = file
    const d = detail
    void app.settings.ignoreWhitespace
    blob = null
    diffError = null
    if (!f || !d) return
    const my = ++dseq
    diffLoading = true
    app.backend
      .diff(repo.root, { kind: 'commit', sha: d.sha, path: f.path, oldPath: f.oldPath }, { ignoreWhitespace: app.settings.ignoreWhitespace })
      .then((b) => {
        if (my === dseq) blob = b
      })
      .catch((e) => {
        if (my === dseq) diffError = errorMessage(e)
      })
      .finally(() => {
        if (my === dseq) diffLoading = false
      })
  })

  async function loadBranches() {
    if (!detail) return
    try {
      branches = await app.backend.commitBranches(repo.root, detail.sha)
    } catch (e) {
      app.toast(errorMessage(e), 'error')
    }
  }

  const body = $derived(detail ? detail.message.split('\n').slice(1).join('\n').trim() : '')
  const subject = $derived(detail ? detail.message.split('\n')[0] : '')
</script>

{#if !sha}
  <div class="empty">커밋을 고르세요</div>
{:else if error}
  <div class="empty err">{error}</div>
{:else}
  <Split key="{key}-detail" initial={0.42} min={220}>
    {#snippet a()}
      <div class="left">
        {#if detail}
          <div class="meta">
            <div class="who">
              <span class="avatar" style="background:hsl({nameHue(detail.author)} 45% 45%)">{initial(detail.author)}</span>
              <div class="names">
                <div><b>{detail.author}</b> <span class="muted">&lt;{detail.email}&gt;</span></div>
                <div class="muted">{dateTime(detail.time, true)}{#if detail.committer !== detail.author} · 커밋: {detail.committer}{/if}</div>
              </div>
            </div>
            <div class="subject">{subject}</div>
            {#if body}<pre class="body">{body}</pre>{/if}
            <div class="kv">
              <span class="k">커밋</span>
              <button class="link mono" title="해시 복사" onclick={() => app.copy(detail!.sha, '해시')}>{detail.sha}</button>
              <span class="k">부모</span>
              <span>
                {#each detail.parents as p (p)}
                  <button class="link mono" onclick={() => repo.reveal(p)}>{short(p)}</button>{' '}
                {:else}
                  <span class="muted">없음 (첫 커밋)</span>
                {/each}
              </span>
              <span class="k">브랜치</span>
              <span>
                {#if branches}
                  {#each branches as b (b)}<span class="br">{b}</span>{:else}<span class="muted">없음</span>{/each}
                {:else}
                  <button class="link" onclick={loadBranches}>포함된 브랜치 보기</button>
                {/if}
              </span>
            </div>
          </div>
          <div class="pane-head files-head">
            <span class="title">바뀐 파일 {detail.files.length}</span>
            <span class="grow"></span>
            <div class="seg">
              <button class:on={!tree} title="목록" onclick={() => (tree = false)}><Icon name="list" size={13} /></button>
              <button class:on={tree} title="트리" onclick={() => (tree = true)}><Icon name="tree" size={13} /></button>
            </div>
          </div>
          <div class="files">
            <FileList
              files={detail.files}
              {tree}
              selected={file?.path ?? null}
              onselect={(f) => (file = detail!.files.find((x) => x.path === f.path) ?? null)}
              oncontext={(e, f) => app.openMenu(e, fileMenu(repo, { path: f.path, rev: detail!.sha, deleted: f.status === 'D' }))}
              ondblclick={(f) => repo.openFileHistory({ path: f.path, rev: detail!.sha })}
            />
          </div>
        {:else}
          <div class="empty">불러오는 중…</div>
        {/if}
      </div>
    {/snippet}
    {#snippet b()}
      <DiffView {blob} loading={diffLoading} error={diffError} title={file ? (file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path) : ''}>
        {#snippet actions()}
          {#if file}
            <button class="ghost" title="이 파일의 이력" onclick={() => repo.openFileHistory({ path: file!.path, rev: detail?.sha })}><Icon name="history" size={14} />이력</button>
          {/if}
        {/snippet}
      </DiffView>
    {/snippet}
  </Split>
{/if}

<style>
  .left {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .meta {
    flex: none;
    max-height: 48%;
    overflow: auto;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-strong);
    user-select: text;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: #fff;
    font-weight: 700;
    flex: none;
  }
  .names {
    min-width: 0;
    font-size: 12.5px;
  }
  .subject {
    font-weight: 600;
    font-size: 13.5px;
    margin-bottom: 4px;
    word-break: break-word;
  }
  .body {
    margin: 4px 0 8px;
    font-family: var(--font-ui);
    white-space: pre-wrap;
    color: var(--text-2);
  }
  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    font-size: 12px;
    align-items: baseline;
  }
  .k {
    color: var(--muted);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    cursor: pointer;
    font-size: 12px;
  }
  .link:hover {
    text-decoration: underline;
  }
  .br {
    display: inline-block;
    margin: 0 4px 2px 0;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--hover);
  }
  .files-head {
    height: 30px;
  }
  .files {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .err {
    color: var(--err);
  }
</style>
