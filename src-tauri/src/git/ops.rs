//! 저장소를 바꾸는 조작 (M3 직접 조작). 화면에서 사용자가 고르고 확인한 것만 실행한다.
//!
//! - `Git::open_write`로 연 git은 편집기를 띄우지 않는다(`GIT_EDITOR=true`).
//! - 경로는 `:(literal)`을 붙여(`a[1].txt`를 패턴으로 해석하지 않게) 표준 입력으로 넘긴다(`--pathspec-from-file`).
//!   파일이 많아도 명령줄 길이 제한에 걸리지 않는다. (`GIT_LITERAL_PATHSPECS`는 `stash -u`가 파일을 치우지 못하게 해서 쓰지 않는다)
//! - 작업 트리 파일을 버리거나 덮어쓰기 전에 지금 파일을 휴지통에 남긴다. 잘못 버려도 되살릴 수 있다.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{Git, NETWORK, QUICK, SLOW, check_path, check_rev};

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HunkAction {
    Stage,
    Unstage,
    Discard,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PullMode {
    Merge,
    Rebase,
    FfOnly,
}

/// 화면이 요청하는 조작
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Stage { paths: Vec<String> },
    Unstage { paths: Vec<String> },
    /// 변경 버리기. `staged`면 스테이지된 변경까지 HEAD로, 아니면 작업 트리만 스테이지된 상태로 되돌린다
    Discard { paths: Vec<String>, staged: bool },
    /// diff의 헝크 하나 (`header`는 `@@ -1,3 +1,4 @@` 줄)
    Hunk { path: String, header: String, action: HunkAction },
    Commit { message: String, amend: bool },
    Push { branch: Option<String>, remote: Option<String>, force: bool },
    Pull { mode: PullMode },
    BranchCreate { name: String, start: Option<String>, checkout: bool },
    Switch { branch: String },
    /// 원격 브랜치를 추적하는 로컬 브랜치로 전환 (없으면 만든다)
    SwitchRemote { remote_branch: String },
    /// 커밋으로 전환 (분리된 HEAD)
    Detach { rev: String },
    BranchDelete { name: String, force: bool },
    BranchRename { old: String, new: String },
    Merge { rev: String, no_ff: bool },
    StashPush { message: Option<String>, untracked: bool },
    StashApply { index: u32, pop: bool },
    StashDrop { index: u32 },
    TagCreate { name: String, rev: Option<String>, message: Option<String> },
    TagDelete { name: String },
    PushTag { remote: String, name: String },
    CherryPick { rev: String },
    Revert { rev: String },
    /// 진행 중인 병합·rebase·cherry-pick·revert 중단
    Abort,
    /// 진행 중인 작업 계속 (충돌을 해결하고 스테이지한 뒤)
    Continue,
    /// 파일을 그 버전 내용으로 되돌린다 (작업 트리만, 스테이지는 그대로)
    RestoreFile { path: String, rev: String },
    /// `.gitignore`에 한 줄 추가
    Ignore { pattern: String },
}

impl Git {
    pub fn apply_op(&self, op: &Op) -> Result<String, String> {
        match op {
            Op::Stage { paths } => self.with_paths(&["add", "-A"], &[], paths, SLOW),
            Op::Unstage { paths } => self.unstage(paths),
            Op::Discard { paths, staged } => self.discard(paths, *staged),
            Op::Hunk { path, header, action } => self.hunk(path, header, *action),
            Op::Commit { message, amend } => self.commit_with(message, *amend),
            Op::Push { branch, remote, force } => self.push(branch.as_deref(), remote.as_deref(), *force),
            Op::Pull { mode } => {
                let flag = match mode {
                    PullMode::Merge => "--no-rebase",
                    PullMode::Rebase => "--rebase",
                    PullMode::FfOnly => "--ff-only",
                };
                self.run_op(&["pull", flag], None, NETWORK)
            }
            Op::BranchCreate { name, start, checkout } => {
                let name = self.branch_name(name)?;
                let mut args = if *checkout { vec!["switch", "-c", &name] } else { vec!["branch", &name] };
                if let Some(s) = start {
                    args.push(check_rev(s)?);
                }
                self.run_op(&args, None, SLOW)
            }
            Op::Switch { branch } => self.run_op(&["switch", check_rev(branch)?], None, SLOW),
            Op::SwitchRemote { remote_branch } => self.switch_remote(remote_branch),
            Op::Detach { rev } => self.run_op(&["switch", "--detach", check_rev(rev)?], None, SLOW),
            Op::BranchDelete { name, force } => self.run_op(&["branch", if *force { "-D" } else { "-d" }, check_rev(name)?], None, QUICK),
            Op::BranchRename { old, new } => {
                let new = self.branch_name(new)?;
                self.run_op(&["branch", "-m", check_rev(old)?, &new], None, QUICK)
            }
            Op::Merge { rev, no_ff } => {
                let mut args = vec!["merge", "--no-edit"];
                if *no_ff {
                    args.push("--no-ff");
                }
                args.push(check_rev(rev)?);
                self.run_op(&args, None, NETWORK)
            }
            Op::StashPush { message, untracked } => {
                let mut args: Vec<String> = vec!["stash".into(), "push".into()];
                if *untracked {
                    args.push("--include-untracked".into());
                }
                if let Some(m) = message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
                    args.push(format!("--message={m}"));
                }
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                self.run_op(&refs, None, SLOW)
            }
            Op::StashApply { index, pop } => self.run_op(&["stash", if *pop { "pop" } else { "apply" }, &format!("stash@{{{index}}}")], None, SLOW),
            Op::StashDrop { index } => self.run_op(&["stash", "drop", &format!("stash@{{{index}}}")], None, QUICK),
            Op::TagCreate { name, rev, message } => {
                let name = self.tag_name(name)?;
                let mut args: Vec<String> = vec!["tag".into()];
                if let Some(m) = message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
                    args.extend(["-a".into(), format!("--message={m}")]);
                }
                args.push(name);
                if let Some(r) = rev {
                    args.push(check_rev(r)?.into());
                }
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                self.run_op(&refs, None, QUICK)
            }
            Op::TagDelete { name } => self.run_op(&["tag", "-d", check_rev(name)?], None, QUICK),
            Op::PushTag { remote, name } => {
                let remote = self.remote(remote)?;
                self.run_op(&["push", &remote, &format!("refs/tags/{}", check_rev(name)?)], None, NETWORK)
            }
            Op::CherryPick { rev } => self.run_op(&["cherry-pick", check_rev(rev)?], None, NETWORK),
            Op::Revert { rev } => self.run_op(&["revert", "--no-edit", check_rev(rev)?], None, NETWORK),
            Op::Abort => {
                let cmd = self.state_command()?;
                self.run_op(&[cmd, "--abort"], None, SLOW)
            }
            Op::Continue => match self.state_command()? {
                // 병합은 충돌을 해결한 뒤 커밋하면 끝난다 (메시지는 git이 만든 것)
                "merge" => self.run_op(&["commit", "--no-edit"], None, NETWORK),
                cmd => self.run_op(&[cmd, "--continue"], None, NETWORK),
            },
            Op::RestoreFile { path, rev } => {
                let path = check_path(path)?;
                let rev = check_rev(rev)?;
                recycle(&[self.root().join(path)])?;
                self.run_op(&["restore", &format!("--source={rev}"), "--worktree", "--", &literal(path)], None, SLOW)
            }
            Op::Ignore { pattern } => self.ignore(pattern),
        }
    }

    /// 경로들을 표준 입력으로 넘겨 실행한다 (`args` 뒤에 `--pathspec-from-file`, 그 뒤에 `tail`)
    fn with_paths(&self, args: &[&str], tail: &[&str], paths: &[String], timeout: std::time::Duration) -> Result<String, String> {
        if paths.is_empty() {
            return Err("고른 파일이 없습니다".into());
        }
        let mut input = Vec::new();
        for p in paths {
            input.extend_from_slice(literal(check_path(p)?).as_bytes());
            input.push(0);
        }
        let mut all: Vec<&str> = args.to_vec();
        all.extend(["--pathspec-from-file=-", "--pathspec-file-nul"]);
        all.extend(tail);
        self.run_op(&all, Some(&input), timeout)
    }

    fn unstage(&self, paths: &[String]) -> Result<String, String> {
        if self.has_head() {
            self.with_paths(&["reset", "-q"], &["HEAD"], paths, SLOW)
        } else {
            // 첫 커밋 전: 인덱스에서만 뺀다
            self.with_paths(&["rm", "--cached", "-q", "-r", "--ignore-unmatch"], &[], paths, SLOW)
        }
    }

    fn discard(&self, paths: &[String], staged: bool) -> Result<String, String> {
        let st = self.status()?;
        let untracked: HashSet<&str> = st.unstaged.iter().filter(|f| f.status == "?").map(|f| f.path.as_str()).collect();
        let worktree: HashSet<&str> = st.unstaged.iter().filter(|f| f.status != "?").map(|f| f.path.as_str()).collect();
        let indexed: HashSet<&str> =
            st.staged.iter().chain(st.conflicted.iter()).flat_map(|f| std::iter::once(f.path.as_str()).chain(f.old_path.as_deref())).collect();
        let mut trash: Vec<PathBuf> = Vec::new();
        let mut restore: Vec<String> = Vec::new();
        for p in paths {
            let p = check_path(p)?;
            if untracked.contains(p) {
                trash.push(self.root().join(p));
            } else if worktree.contains(p) || (staged && indexed.contains(p)) {
                trash.push(self.root().join(p));
                restore.push(p.to_string());
            }
        }
        if trash.is_empty() && restore.is_empty() {
            return Err("버릴 변경이 없습니다".into());
        }
        // 지금 파일을 먼저 휴지통에 남긴 뒤 되돌린다
        recycle(&trash)?;
        if restore.is_empty() {
            return Ok(String::new());
        }
        if !staged {
            self.with_paths(&["restore", "--worktree"], &[], &restore, SLOW)
        } else if self.has_head() {
            self.with_paths(&["restore", "--source=HEAD", "--staged", "--worktree"], &[], &restore, SLOW)
        } else {
            self.with_paths(&["rm", "--cached", "-q", "-r", "--ignore-unmatch"], &[], &restore, SLOW)
        }
    }

    fn hunk(&self, path: &str, header: &str, action: HunkAction) -> Result<String, String> {
        let path = check_path(path)?;
        // 화면이 보여 준 diff와 같은 명령으로 다시 만들어 그 헝크를 찾는다
        let mut args = vec!["diff", "--no-ext-diff", "--no-color", "-M", "--src-prefix=a/", "--dst-prefix=b/"];
        if action == HunkAction::Unstage {
            args.push("--cached");
        }
        let lp = literal(path);
        args.extend(["--", &lp]);
        let diff = self.run_raw(&args, None, SLOW, &[])?.stdout;
        let patch = pick_hunk(&diff, header)?;
        let apply: &[&str] = match action {
            HunkAction::Stage => &["apply", "--cached", "--whitespace=nowarn", "-"],
            HunkAction::Unstage => &["apply", "--cached", "-R", "--whitespace=nowarn", "-"],
            HunkAction::Discard => {
                backup_copy(&self.root().join(path))?;
                &["apply", "-R", "--whitespace=nowarn", "-"]
            }
        };
        self.run_op(apply, Some(&patch), QUICK)
    }

    fn commit_with(&self, message: &str, amend: bool) -> Result<String, String> {
        if message.trim().is_empty() {
            return Err("커밋 메시지를 쓰세요".into());
        }
        let mut args = vec!["commit", "--file=-"];
        if amend {
            args.push("--amend");
        }
        // hook(pre-commit 등)이 오래 걸릴 수 있다
        self.run_op(&args, Some(message.as_bytes()), NETWORK)
    }

    pub fn current_branch(&self) -> Option<String> {
        self.run(&["symbolic-ref", "--short", "-q", "HEAD"], QUICK).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    fn config(&self, key: &str) -> Option<String> {
        self.run(&["config", "--get", key], QUICK).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    fn remote(&self, name: &str) -> Result<String, String> {
        let name = check_rev(name)?;
        if self.remote_names().iter().any(|r| r == name) { Ok(name.to_string()) } else { Err(format!("원격 저장소가 없습니다: {name}")) }
    }

    fn branch_name(&self, name: &str) -> Result<String, String> {
        let n = check_rev(name)?;
        self.run(&["check-ref-format", "--branch", n], QUICK)
            .map(|s| s.trim().to_string())
            .map_err(|_| format!("브랜치 이름으로 쓸 수 없습니다: {n}"))
    }

    fn tag_name(&self, name: &str) -> Result<String, String> {
        let n = check_rev(name)?;
        self.run(&["check-ref-format", &format!("refs/tags/{n}")], QUICK).map(|_| n.to_string()).map_err(|_| format!("태그 이름으로 쓸 수 없습니다: {n}"))
    }

    fn ref_exists(&self, full: &str) -> bool {
        self.run(&["rev-parse", "--verify", "--quiet", full], QUICK).is_ok_and(|s| !s.trim().is_empty())
    }

    /// 브랜치를 원격에 올린다. 추적 브랜치가 있으면 그곳으로, 없으면 같은 이름으로 올리고 추적을 건다.
    /// `force`는 `--force-with-lease`(내가 마지막으로 본 원격 위치일 때만 덮어씀)
    fn push(&self, branch: Option<&str>, remote: Option<&str>, force: bool) -> Result<String, String> {
        let branch = match branch {
            Some(b) => check_rev(b)?.to_string(),
            None => self.current_branch().ok_or("분리된 HEAD라 push할 브랜치가 없습니다")?,
        };
        if !self.ref_exists(&format!("refs/heads/{branch}")) {
            return Err(format!("로컬 브랜치가 없습니다: {branch}"));
        }
        let cfg_remote = self.config(&format!("branch.{branch}.remote")).filter(|r| r != ".");
        let cfg_merge = self.config(&format!("branch.{branch}.merge"));
        let remotes = self.remote_names();
        let remote = match remote {
            Some(r) => self.remote(r)?,
            None => cfg_remote
                .clone()
                .or_else(|| (remotes.len() == 1).then(|| remotes[0].clone()))
                .or_else(|| remotes.iter().find(|r| *r == "origin").cloned())
                .ok_or("원격 저장소가 없습니다. 먼저 git remote add로 원격을 추가하세요")?,
        };
        let (dst, set_upstream) = match (&cfg_remote, &cfg_merge) {
            (Some(r), Some(m)) if *r == remote => (m.clone(), false),
            _ => (format!("refs/heads/{branch}"), cfg_merge.is_none()),
        };
        let refspec = format!("refs/heads/{branch}:{dst}");
        let mut args = vec!["push"];
        if force {
            args.push("--force-with-lease");
        }
        if set_upstream {
            args.push("--set-upstream");
        }
        args.extend([remote.as_str(), refspec.as_str()]);
        self.run_op(&args, None, NETWORK)
    }

    fn switch_remote(&self, remote_branch: &str) -> Result<String, String> {
        let rb = check_rev(remote_branch)?;
        let local = self
            .remote_names()
            .iter()
            .find_map(|r| rb.strip_prefix(&format!("{r}/")).map(String::from))
            .ok_or_else(|| format!("원격 브랜치가 아닙니다: {rb}"))?;
        if self.ref_exists(&format!("refs/heads/{local}")) {
            let up = self.run(&["rev-parse", "--abbrev-ref", &format!("{local}@{{upstream}}")], QUICK).ok().map(|s| s.trim().to_string());
            if up.as_deref() == Some(rb) {
                return self.run_op(&["switch", &local], None, SLOW);
            }
            return Err(format!("같은 이름의 로컬 브랜치 {local}이(가) 이미 있습니다 (다른 곳을 추적). 그 브랜치로 전환하거나 새 이름으로 만드세요"));
        }
        self.run_op(&["switch", "-c", &local, "--track", rb], None, SLOW)
    }

    /// 진행 중인 작업에 맞는 git 명령 (abort·continue용)
    fn state_command(&self) -> Result<&'static str, String> {
        match self.state().as_deref() {
            Some("merging") => Ok("merge"),
            Some("rebasing") => Ok("rebase"),
            Some("cherry-picking") => Ok("cherry-pick"),
            Some("reverting") => Ok("revert"),
            _ => Err("진행 중인 병합·rebase가 없습니다".into()),
        }
    }

    fn ignore(&self, pattern: &str) -> Result<String, String> {
        let p = pattern.trim();
        if p.is_empty() || p.contains(['\n', '\r', '\0']) {
            return Err(format!("무시 규칙이 올바르지 않습니다: {pattern}"));
        }
        let file = self.root().join(".gitignore");
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        if text.lines().any(|l| l.trim() == p) {
            return Ok(format!(".gitignore에 이미 있습니다: {p}"));
        }
        let mut next = text;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push_str(if next.contains("\r\n") { "\r\n" } else { "\n" });
        }
        next.push_str(p);
        next.push('\n');
        std::fs::write(&file, next).map_err(|e| format!(".gitignore를 쓰지 못했습니다: {e}"))?;
        Ok(format!(".gitignore에 추가했습니다: {p}"))
    }
}

/// diff에서 `header`(`@@ -a,b +c,d @@`)와 같은 헝크를 골라, 파일 머리와 그 헝크만 담은 patch를 만든다
pub fn pick_hunk(diff: &[u8], header: &str) -> Result<Vec<u8>, String> {
    const CHANGED: &str = "파일이 그사이 바뀌어 그 부분을 찾지 못했습니다. 화면을 확인한 뒤 다시 해 보세요";
    let want = hunk_range(header).ok_or("헝크 머리가 올바르지 않습니다")?;
    let lines: Vec<&[u8]> = diff.split_inclusive(|b| *b == b'\n').collect();
    let first = lines.iter().position(|l| l.starts_with(b"@@ ")).ok_or(CHANGED)?;
    let head = &lines[..first];
    if head.iter().any(|l| [&b"rename from"[..], b"copy from", b"new file mode", b"deleted file mode"].iter().any(|p| l.starts_with(p))) {
        return Err("새 파일·지운 파일·이름이 바뀐 파일은 헝크 단위로 다룰 수 없습니다. 파일 단위로 하세요".into());
    }
    let mut i = first;
    while i < lines.len() {
        if lines[i].starts_with(b"diff --git ") {
            break;
        }
        if !lines[i].starts_with(b"@@ ") {
            i += 1;
            continue;
        }
        let end = (i + 1..lines.len()).find(|&j| lines[j].starts_with(b"@@ ") || lines[j].starts_with(b"diff --git ")).unwrap_or(lines.len());
        if hunk_range(&String::from_utf8_lossy(lines[i])).as_deref() == Some(want.as_str()) {
            let mut out: Vec<u8> = head.concat();
            for l in &lines[i..end] {
                out.extend_from_slice(l);
            }
            return Ok(out);
        }
        i = end;
    }
    Err(CHANGED.into())
}

/// 경로를 패턴이 아닌 글자 그대로 맞추는 pathspec
fn literal(path: &str) -> String {
    format!(":(literal){path}")
}

/// `@@ -1,3 +1,4 @@ fn x` → `-1,3 +1,4`
fn hunk_range(line: &str) -> Option<String> {
    let rest = line.strip_prefix("@@ ")?;
    Some(rest[..rest.find(" @@")?].to_string())
}

/// 파일들을 휴지통으로 보낸다 (없는 파일은 건너뜀). 테스트에서는 그냥 지운다
pub fn recycle(paths: &[PathBuf]) -> Result<(), String> {
    let paths: Vec<&PathBuf> = paths.iter().filter(|p| p.symlink_metadata().is_ok_and(|m| !m.is_dir())).collect();
    if paths.is_empty() {
        return Ok(());
    }
    #[cfg(all(windows, not(test)))]
    {
        use windows_sys::Win32::UI::Shell::{FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, SHFILEOPSTRUCTW, SHFileOperationW};
        // 이중 NUL로 끝나는 전체 경로 목록
        let mut from: Vec<u16> = Vec::new();
        for p in &paths {
            from.extend(p.to_string_lossy().replace('/', "\\").encode_utf16());
            from.push(0);
        }
        from.push(0);
        let mut op = SHFILEOPSTRUCTW {
            hwnd: std::ptr::null_mut(),
            wFunc: FO_DELETE,
            pFrom: from.as_ptr(),
            pTo: std::ptr::null(),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as _,
            fAnyOperationsAborted: 0,
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: std::ptr::null(),
        };
        // SAFETY: from은 이중 NUL로 끝나고 호출이 끝날 때까지 살아 있다
        let r = unsafe { SHFileOperationW(&mut op) };
        if r != 0 || op.fAnyOperationsAborted != 0 {
            return Err(format!("파일을 휴지통으로 옮기지 못했습니다 (코드 {r}). 파일을 다른 프로그램이 쓰고 있는지 확인하세요"));
        }
        Ok(())
    }
    #[cfg(any(not(windows), test))]
    {
        for p in paths {
            std::fs::remove_file(p).map_err(|e| format!("{}: {e}", p.display()))?;
        }
        Ok(())
    }
}

/// 파일을 그대로 둔 채 지금 내용을 휴지통에 남긴다 (헝크 버리기 전)
fn backup_copy(file: &Path) -> Result<(), String> {
    if !file.is_file() {
        return Ok(());
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = std::env::temp_dir().join("NanoGit-backup").join(stamp.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let copy = dir.join(file.file_name().unwrap_or_default());
    std::fs::copy(file, &copy).map_err(|e| format!("버리기 전 사본을 만들지 못했습니다: {e}"))?;
    let r = recycle(&[copy]);
    let _ = std::fs::remove_dir(&dir);
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::query::tests::sh;

    fn git(root: &Path) -> Git {
        Git::open_write(root).unwrap()
    }

    fn status_line(g: &Git) -> String {
        let s = g.status().unwrap();
        let mut v: Vec<String> = s.staged.iter().map(|f| format!("S{}:{}", f.status, f.path)).collect();
        v.extend(s.unstaged.iter().map(|f| format!("W{}:{}", f.status, f.path)));
        v.sort();
        v.join(" ")
    }

    fn repo() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("app");
        std::fs::create_dir_all(&root).unwrap();
        sh(&root, &["init", "-q"]);
        // 조작(커밋)은 저장소 설정을 쓴다 (CI에는 사용자 설정이 없다)
        for (k, v) in [("user.name", "홍길동"), ("user.email", "hong@example.com"), ("commit.gpgsign", "false"), ("core.autocrlf", "false")] {
            sh(&root, &["config", k, v]);
        }
        (tmp, root)
    }

    /// 화면(types.ts의 GitOp)이 보내는 모양 그대로 읽히는지
    #[test]
    fn reads_ops_from_frontend_json() {
        let read = |s: &str| serde_json::from_str::<Op>(s).unwrap();
        assert!(matches!(read(r#"{"kind":"stage","paths":["a.txt"]}"#), Op::Stage { paths } if paths == ["a.txt"]));
        assert!(matches!(read(r#"{"kind":"branchCreate","name":"x","start":null,"checkout":true}"#), Op::BranchCreate { checkout: true, start: None, .. }));
        assert!(matches!(read(r#"{"kind":"switchRemote","remoteBranch":"origin/x"}"#), Op::SwitchRemote { remote_branch } if remote_branch == "origin/x"));
        assert!(matches!(read(r#"{"kind":"merge","rev":"dev","noFf":true}"#), Op::Merge { no_ff: true, .. }));
        assert!(matches!(read(r#"{"kind":"pull","mode":"ff-only"}"#), Op::Pull { mode: PullMode::FfOnly }));
        assert!(matches!(read(r#"{"kind":"hunk","path":"a","header":"@@ -1 +1 @@","action":"discard"}"#), Op::Hunk { action: HunkAction::Discard, .. }));
        assert!(matches!(read(r#"{"kind":"stashPush","message":null,"untracked":true}"#), Op::StashPush { untracked: true, .. }));
        assert!(matches!(read(r#"{"kind":"continue"}"#), Op::Continue));
        assert!(serde_json::from_str::<Op>(r#"{"kind":"resetHard"}"#).is_err(), "모르는 조작은 받지 않는다");
    }

    #[test]
    fn picks_one_hunk() {
        let diff = b"diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -10,2 +10,2 @@ fn x\n-y\n+Y\n z\n";
        let p = pick_hunk(diff, "@@ -10,2 +10,2 @@ fn x").unwrap();
        assert_eq!(String::from_utf8(p).unwrap(), "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -10,2 +10,2 @@ fn x\n-y\n+Y\n z\n");
        assert!(pick_hunk(diff, "@@ -5,2 +5,2 @@").is_err());
        let new_file = b"diff --git a/f b/f\nnew file mode 100644\n--- /dev/null\n+++ b/f\n@@ -0,0 +1 @@\n+a\n";
        assert!(pick_hunk(new_file, "@@ -0,0 +1 @@").unwrap_err().contains("헝크 단위"));
    }

    #[test]
    fn stage_unstage_discard_commit() {
        let (_t, root) = repo();
        let g = git(&root);
        std::fs::write(root.join("a.txt"), "1\n").unwrap();
        std::fs::write(root.join("b[1].txt"), "b\n").unwrap();
        // 첫 커밋 전 스테이지·언스테이지
        g.apply_op(&Op::Stage { paths: vec!["a.txt".into(), "b[1].txt".into()] }).unwrap();
        assert_eq!(status_line(&g), "SA:a.txt SA:b[1].txt");
        g.apply_op(&Op::Unstage { paths: vec!["b[1].txt".into()] }).unwrap();
        assert_eq!(status_line(&g), "SA:a.txt W?:b[1].txt");
        g.apply_op(&Op::Commit { message: "첫 커밋".into(), amend: false }).unwrap();
        assert_eq!(g.run(&["log", "-1", "--format=%s"], QUICK).unwrap().trim(), "첫 커밋");

        // 경로가 패턴으로 해석되지 않는다 (b[1].txt가 b1.txt를 뜻하지 않음)
        std::fs::write(root.join("b1.txt"), "x\n").unwrap();
        g.apply_op(&Op::Stage { paths: vec!["b[1].txt".into()] }).unwrap();
        assert_eq!(status_line(&g), "SA:b[1].txt W?:b1.txt");
        g.apply_op(&Op::Unstage { paths: vec!["b[1].txt".into()] }).unwrap();

        // 작업 트리만 버리기: 스테이지된 내용으로 돌아간다
        std::fs::write(root.join("a.txt"), "2\n").unwrap();
        g.apply_op(&Op::Stage { paths: vec!["a.txt".into()] }).unwrap();
        std::fs::write(root.join("a.txt"), "3\n").unwrap();
        g.apply_op(&Op::Discard { paths: vec!["a.txt".into(), "b1.txt".into()], staged: false }).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "2\n");
        assert!(!root.join("b1.txt").exists(), "추적 안 하는 파일은 지운다(휴지통)");
        // 스테이지까지 버리기: HEAD로
        g.apply_op(&Op::Discard { paths: vec!["a.txt".into()], staged: true }).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "1\n");
        assert_eq!(status_line(&g), "W?:b[1].txt");
        assert!(g.apply_op(&Op::Discard { paths: vec!["a.txt".into()], staged: false }).is_err(), "버릴 게 없으면 알린다");

        // amend
        g.apply_op(&Op::Commit { message: "고친 첫 커밋".into(), amend: true }).unwrap();
        assert_eq!(g.run(&["log", "--format=%s"], QUICK).unwrap().trim(), "고친 첫 커밋");
        assert!(g.apply_op(&Op::Commit { message: "  ".into(), amend: false }).is_err());
    }

    #[test]
    fn hunks() {
        let (_t, root) = repo();
        let g = git(&root);
        let base: String = (1..=30).map(|i| format!("line {i}\n")).collect();
        std::fs::write(root.join("h.txt"), &base).unwrap();
        sh(&root, &["add", "-A"]);
        sh(&root, &["commit", "-qm", "base"]);
        let changed = base.replace("line 3\n", "line 3 changed\n").replace("line 25\n", "line 25 changed\n");
        std::fs::write(root.join("h.txt"), &changed).unwrap();
        let headers = |cached: bool| -> Vec<String> {
            let mut a = vec!["diff"];
            if cached {
                a.push("--cached");
            }
            g.run(&a, QUICK).unwrap().lines().filter(|l| l.starts_with("@@ ")).map(String::from).collect()
        };
        let h = headers(false);
        assert_eq!(h.len(), 2);
        // 두 번째 헝크만 스테이지
        g.apply_op(&Op::Hunk { path: "h.txt".into(), header: h[1].clone(), action: HunkAction::Stage }).unwrap();
        assert!(g.run(&["diff", "--cached"], QUICK).unwrap().contains("+line 25 changed"));
        assert!(!g.run(&["diff", "--cached"], QUICK).unwrap().contains("line 3 changed"));
        // 첫 번째 헝크 버리기 (작업 트리)
        let h = headers(false);
        assert_eq!(h.len(), 1);
        g.apply_op(&Op::Hunk { path: "h.txt".into(), header: h[0].clone(), action: HunkAction::Discard }).unwrap();
        let now = std::fs::read_to_string(root.join("h.txt")).unwrap();
        assert!(!now.contains("line 3 changed") && now.contains("line 25 changed"));
        // 스테이지된 헝크 되돌리기
        let h = headers(true);
        g.apply_op(&Op::Hunk { path: "h.txt".into(), header: h[0].clone(), action: HunkAction::Unstage }).unwrap();
        assert!(g.run(&["diff", "--cached"], QUICK).unwrap().is_empty());
        // 없는 헝크
        assert!(g.apply_op(&Op::Hunk { path: "h.txt".into(), header: "@@ -90,1 +90,1 @@".into(), action: HunkAction::Stage }).is_err());
    }

    #[test]
    fn branches_merge_stash_tags_push() {
        let (tmp, root) = repo();
        let g = git(&root);
        std::fs::write(root.join("a.txt"), "1\n").unwrap();
        sh(&root, &["add", "-A"]);
        sh(&root, &["commit", "-qm", "init"]);
        // 원격 (bare)
        let remote = tmp.path().join("remote.git");
        sh(tmp.path(), &["init", "-q", "--bare", remote.to_str().unwrap()]);
        sh(&root, &["remote", "add", "origin", remote.to_str().unwrap()]);
        g.apply_op(&Op::Push { branch: None, remote: None, force: false }).unwrap();
        assert_eq!(g.run(&["rev-parse", "--abbrev-ref", "main@{upstream}"], QUICK).unwrap().trim(), "origin/main", "처음 push하면 추적을 건다");

        // 브랜치 만들고 전환 → 커밋 → main으로 돌아와 병합
        assert!(g.apply_op(&Op::BranchCreate { name: "bad..name".into(), start: None, checkout: true }).is_err());
        g.apply_op(&Op::BranchCreate { name: "feature/x".into(), start: None, checkout: true }).unwrap();
        assert_eq!(g.current_branch().as_deref(), Some("feature/x"));
        std::fs::write(root.join("x.txt"), "x\n").unwrap();
        g.apply_op(&Op::Stage { paths: vec!["x.txt".into()] }).unwrap();
        g.apply_op(&Op::Commit { message: "x 추가".into(), amend: false }).unwrap();
        g.apply_op(&Op::Switch { branch: "main".into() }).unwrap();
        g.apply_op(&Op::Merge { rev: "feature/x".into(), no_ff: true }).unwrap();
        assert_eq!(g.run(&["log", "-1", "--format=%P"], QUICK).unwrap().split_whitespace().count(), 2, "--no-ff는 병합 커밋");
        g.apply_op(&Op::BranchRename { old: "feature/x".into(), new: "feature/y".into() }).unwrap();
        g.apply_op(&Op::BranchDelete { name: "feature/y".into(), force: false }).unwrap();

        // stash
        std::fs::write(root.join("a.txt"), "changed\n").unwrap();
        std::fs::write(root.join("new.txt"), "n\n").unwrap();
        g.apply_op(&Op::StashPush { message: Some("작업 중".into()), untracked: true }).unwrap();
        assert_eq!(status_line(&g), "");
        g.apply_op(&Op::StashApply { index: 0, pop: false }).unwrap();
        assert!(root.join("new.txt").exists());
        g.apply_op(&Op::StashDrop { index: 0 }).unwrap();
        assert!(g.run(&["stash", "list"], QUICK).unwrap().trim().is_empty());
        g.apply_op(&Op::Discard { paths: vec!["a.txt".into(), "new.txt".into()], staged: true }).unwrap();

        // 태그와 태그 push
        g.apply_op(&Op::TagCreate { name: "v1.0".into(), rev: None, message: Some("첫 릴리스".into()) }).unwrap();
        g.apply_op(&Op::PushTag { remote: "origin".into(), name: "v1.0".into() }).unwrap();
        let remote_tags = g.run(&["ls-remote", "--tags", "origin"], QUICK).unwrap();
        assert!(remote_tags.contains("refs/tags/v1.0"));
        g.apply_op(&Op::TagDelete { name: "v1.0".into() }).unwrap();
        assert!(g.apply_op(&Op::PushTag { remote: "nowhere".into(), name: "v1.0".into() }).is_err());

        // push 대기 → push (추적 브랜치로)
        g.apply_op(&Op::Push { branch: Some("main".into()), remote: None, force: false }).unwrap();
        assert_eq!(g.run(&["rev-list", "--count", "origin/main..main"], QUICK).unwrap().trim(), "0");

        // 원격 브랜치를 추적하는 로컬 브랜치로 전환
        sh(&root, &["push", "-q", "origin", "main:refs/heads/topic"]);
        sh(&root, &["fetch", "-q", "origin"]);
        g.apply_op(&Op::SwitchRemote { remote_branch: "origin/topic".into() }).unwrap();
        assert_eq!(g.current_branch().as_deref(), Some("topic"));
        assert_eq!(g.run(&["rev-parse", "--abbrev-ref", "topic@{upstream}"], QUICK).unwrap().trim(), "origin/topic");
        g.apply_op(&Op::Switch { branch: "main".into() }).unwrap();
    }

    #[test]
    fn conflict_abort_and_continue() {
        let (_t, root) = repo();
        let g = git(&root);
        std::fs::write(root.join("a.txt"), "base\n").unwrap();
        sh(&root, &["add", "-A"]);
        sh(&root, &["commit", "-qm", "base"]);
        let base = g.run(&["rev-parse", "HEAD"], QUICK).unwrap().trim().to_string();
        sh(&root, &["switch", "-q", "-c", "other"]);
        std::fs::write(root.join("a.txt"), "other\n").unwrap();
        sh(&root, &["commit", "-qam", "other"]);
        sh(&root, &["switch", "-q", "main"]);
        std::fs::write(root.join("a.txt"), "mine\n").unwrap();
        sh(&root, &["commit", "-qam", "mine"]);

        let err = g.apply_op(&Op::Merge { rev: "other".into(), no_ff: false }).unwrap_err();
        assert!(err.contains("CONFLICT"), "충돌 목록이 메시지에 있어야 함: {err}");
        assert_eq!(g.state().as_deref(), Some("merging"));
        g.apply_op(&Op::Abort).unwrap();
        assert_eq!(g.state(), None);

        // 다시 병합 → 해결하고 스테이지 → 계속
        assert!(g.apply_op(&Op::Merge { rev: "other".into(), no_ff: false }).is_err());
        std::fs::write(root.join("a.txt"), "resolved\n").unwrap();
        g.apply_op(&Op::Stage { paths: vec!["a.txt".into()] }).unwrap();
        g.apply_op(&Op::Continue).unwrap();
        assert_eq!(g.state(), None);
        assert!(g.run(&["log", "-1", "--format=%s"], QUICK).unwrap().contains("Merge branch 'other'"));
        assert!(g.apply_op(&Op::Abort).is_err(), "진행 중인 작업이 없으면 알린다");

        // revert → cherry-pick으로 되살리기
        std::fs::write(root.join("c.txt"), "c\n").unwrap();
        sh(&root, &["add", "-A"]);
        sh(&root, &["commit", "-qm", "c 추가"]);
        let c = g.run(&["rev-parse", "HEAD"], QUICK).unwrap().trim().to_string();
        g.apply_op(&Op::Revert { rev: c.clone() }).unwrap();
        assert!(!root.join("c.txt").exists());
        sh(&root, &["switch", "-q", "-c", "pick", "HEAD~2"]);
        g.apply_op(&Op::CherryPick { rev: c }).unwrap();
        assert!(root.join("c.txt").exists());

        // 파일을 이전 버전 내용으로 (작업 트리만), .gitignore
        g.apply_op(&Op::RestoreFile { path: "a.txt".into(), rev: base }).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "base\n");
        assert!(status_line(&g).contains("WM:a.txt"));
        g.apply_op(&Op::Ignore { pattern: "/build/".into() }).unwrap();
        assert!(g.apply_op(&Op::Ignore { pattern: "/build/".into() }).unwrap().contains("이미"));
        assert_eq!(std::fs::read_to_string(root.join(".gitignore")).unwrap(), "/build/\n");
        assert!(g.apply_op(&Op::Ignore { pattern: "a\nb".into() }).is_err());
    }
}
