//! 화면으로 보내는 git 데이터. 필드 이름은 camelCase로 직렬화한다 (`src/lib/types.ts`와 맞춘다).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    /// HEAD (현재 브랜치 표시용. 이름은 브랜치 이름 또는 `HEAD`)
    Head,
    Local,
    Remote,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RefLabel {
    pub kind: RefKind,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// 작성 시각 (유닉스 초)
    pub time: i64,
    pub subject: String,
    pub refs: Vec<RefLabel>,
}

/// 히스토리의 작성자 (작성자로 거르기)
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Author {
    pub name: String,
    /// 가장 많이 쓴 메일
    pub email: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// A, M, D, R, C, T, U
    pub status: String,
    pub path: String,
    /// 이름이 바뀌었거나 복사된 경우 이전 경로
    pub old_path: Option<String>,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    /// 메시지 전체 (제목 + 본문)
    pub message: String,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkFile {
    pub path: String,
    pub old_path: Option<String>,
    /// A, M, D, R, C, T, U(충돌), ?(추적 안 함)
    pub status: String,
    /// 작업 트리 파일의 수정 시각 (유닉스 밀리초). 지워진 파일은 없음
    pub mtime: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub root: String,
    /// 현재 브랜치 (분리된 HEAD면 없음)
    pub branch: Option<String>,
    /// HEAD 커밋 (커밋이 하나도 없으면 없음)
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// merging, rebasing, cherry-picking, reverting, bisecting
    pub state: Option<String>,
    pub staged: Vec<WorkFile>,
    /// 스테이지 안 된 변경 + 추적 안 하는 파일
    pub unstaged: Vec<WorkFile>,
    pub conflicted: Vec<WorkFile>,
    /// 파일이 너무 많아 일부만 담았음
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub sha: String,
    /// `origin/main` 같은 짧은 이름
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// 추적하던 원격 브랜치가 사라짐
    pub gone: bool,
    pub time: i64,
    pub subject: String,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    /// `origin/main`
    pub name: String,
    pub sha: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: Option<String>,
    pub branches: Vec<RemoteBranch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    /// 태그가 가리키는 커밋
    pub sha: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: u32,
    pub sha: String,
    pub time: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refs {
    pub branches: Vec<Branch>,
    pub remotes: Vec<Remote>,
    pub tags: Vec<Tag>,
    pub stashes: Vec<Stash>,
}

/// 히스토리 범위
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LogScope {
    /// 모든 브랜치·원격·태그
    All,
    /// 현재 브랜치(HEAD)
    Current,
    /// 지정한 리비전들 (`a..b` 같은 범위 포함)
    Revs { revs: Vec<String> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    pub scope: LogScope,
    #[serde(default)]
    pub skip: u32,
    pub limit: u32,
    /// 메시지(대소문자 무시) 검색
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    /// 이 경로를 바꾼 커밋만
    #[serde(default)]
    pub path: Option<String>,
}

/// diff 대상
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DiffTarget {
    /// 작업 트리 (스테이지 안 된 변경). 추적 안 하는 파일은 전체가 추가로 보인다
    Worktree { path: String, untracked: bool },
    /// 스테이지된 변경
    Staged { path: String, old_path: Option<String> },
    /// 커밋이 바꾼 내용 (첫 번째 부모와 비교)
    Commit { sha: String, path: String, old_path: Option<String> },
    /// 두 리비전 사이 (`from`이 없으면 빈 트리)
    Range { from: Option<String>, to: String, path: String, old_path: Option<String> },
    /// 두 버전의 파일 비교 (경로가 달라도 됨)
    Blobs { a_rev: String, a_path: String, b_rev: String, b_path: String },
    /// 리비전의 파일과 지금 작업 트리 파일 비교
    RevToWorktree { rev: String, rev_path: String, path: String },
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiffOptions {
    #[serde(default)]
    pub ignore_whitespace: bool,
    #[serde(default)]
    pub context: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBlob {
    pub text: String,
    pub binary: bool,
    pub truncated: bool,
    /// utf-8 또는 cp949
    pub encoding: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingBranch {
    pub branch: String,
    pub current: bool,
    pub remote: Option<String>,
    /// push될 원격 브랜치 (`origin/main`). 새 브랜치면 앞으로 만들어질 이름
    pub target: Option<String>,
    /// 원격에 아직 없는 브랜치
    pub new_branch: bool,
    /// 합친 변경의 기준 커밋 (없으면 빈 트리)
    pub base: Option<String>,
    pub commits: Vec<Commit>,
    pub files: Vec<FileChange>,
    /// 원격에만 있는 커밋 수 (pull 필요)
    pub behind: u32,
    /// 커밋이 너무 많아 일부만 담았음
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    /// 유닉스 초
    pub time: i64,
    /// `HEAD`, `refs/heads/main`, `refs/remotes/origin/main`, `refs/stash`
    pub ref_name: String,
    pub old: String,
    pub new: String,
    pub message: String,
    pub who: String,
    pub subject: Option<String>,
    pub old_subject: Option<String>,
    /// 이전 위치에 있었지만 새 위치에서 닿지 않는 커밋 수 (reset·강제 push·amend로 버려진 커밋)
    pub dropped: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub commit: Commit,
    /// 그 커밋 시점의 경로
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub sha: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    /// 그 커밋에서의 파일 경로
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// `commits`의 위치
    pub c: usize,
    pub orig_line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub commits: Vec<BlameCommit>,
    pub lines: Vec<BlameLine>,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineHistoryEntry {
    pub commit: Commit,
    pub diff: String,
}
