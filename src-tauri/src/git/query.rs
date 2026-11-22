//! 저장소 조회. fetch를 빼면 모두 읽기 전용이다.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::model::*;
use super::parse::*;
use super::{Git, NETWORK, QUICK, SLOW, check_path, check_rev, decode, display};

/// 화면에 담을 작업 트리 파일 수 한도
const MAX_STATUS: usize = 5000;
/// diff·파일 내용으로 보여 줄 크기 한도
const MAX_TEXT: usize = 4 * 1024 * 1024;
/// push 대기 커밋을 이보다 많이 담지 않는다
const MAX_OUTGOING: u32 = 500;

impl Git {
    pub fn status(&self) -> Result<Status, String> {
        let out = self.run(&["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--ignore-submodules=dirty"], QUICK)?;
        let mut s = parse_status(&out, MAX_STATUS);
        s.root = display(self.root());
        s.state = self.state();
        let root = self.root().to_path_buf();
        for f in s.unstaged.iter_mut().chain(s.staged.iter_mut()).chain(s.conflicted.iter_mut()) {
            f.mtime = mtime_ms(&root.join(&f.path));
        }
        Ok(s)
    }

    /// 진행 중인 작업 (병합·rebase 등)
    pub fn state(&self) -> Option<String> {
        let g = &self.loc.git_dir;
        let state = if g.join("rebase-merge").is_dir() || g.join("rebase-apply").is_dir() {
            "rebasing"
        } else if g.join("MERGE_HEAD").is_file() {
            "merging"
        } else if g.join("CHERRY_PICK_HEAD").is_file() {
            "cherry-picking"
        } else if g.join("REVERT_HEAD").is_file() {
            "reverting"
        } else if g.join("BISECT_LOG").is_file() {
            "bisecting"
        } else {
            return None;
        };
        Some(state.to_string())
    }

    pub fn refs(&self) -> Result<Refs, String> {
        let fmt = "%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(HEAD)%00%(*objectname)%00%(contents:subject)";
        let out = self.run(&["for-each-ref", "--sort=refname", &format!("--format={fmt}"), "refs/heads", "refs/remotes", "refs/tags"], QUICK)?;
        let mut branches = Vec::new();
        let mut remote_branches: Vec<(String, RemoteBranch)> = Vec::new();
        let mut tags = Vec::new();
        for line in out.lines() {
            let f: Vec<&str> = line.split('\0').collect();
            if f.len() < 8 {
                continue;
            }
            let (refname, sha, upstream, track, time, head, peeled, subject) = (f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7]);
            let time = time.parse().unwrap_or(0);
            if let Some(name) = refname.strip_prefix("refs/heads/") {
                let (ahead, behind, gone) = parse_track(track);
                branches.push(Branch {
                    name: name.into(),
                    sha: sha.into(),
                    upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
                    ahead,
                    behind,
                    gone,
                    time,
                    subject: subject.into(),
                    current: head == "*",
                });
            } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
                if name.ends_with("/HEAD") {
                    continue;
                }
                let remote = name.split('/').next().unwrap_or("").to_string();
                remote_branches.push((remote, RemoteBranch { name: name.into(), sha: sha.into(), time }));
            } else if let Some(name) = refname.strip_prefix("refs/tags/") {
                let sha = if peeled.is_empty() { sha } else { peeled };
                tags.push(Tag { name: name.into(), sha: sha.into(), time });
            }
        }
        let mut remotes: Vec<Remote> = self.remote_urls().into_iter().map(|(name, url)| Remote { name, url, branches: Vec::new() }).collect();
        for (remote, b) in remote_branches {
            match remotes.iter_mut().find(|r| r.name == remote) {
                Some(r) => r.branches.push(b),
                None => remotes.push(Remote { name: remote, url: None, branches: vec![b] }),
            }
        }
        tags.sort_by(|a: &Tag, b: &Tag| b.time.cmp(&a.time));
        Ok(Refs { branches, remotes, tags, stashes: self.stashes().unwrap_or_default() })
    }

    fn remote_urls(&self) -> Vec<(String, Option<String>)> {
        let Ok(out) = self.run(&["remote", "-v"], QUICK) else { return Vec::new() };
        let mut result: Vec<(String, Option<String>)> = Vec::new();
        for line in out.lines() {
            let mut it = line.split_whitespace();
            let (Some(name), url) = (it.next(), it.next()) else { continue };
            if !result.iter().any(|(n, _)| n == name) {
                result.push((name.to_string(), url.map(String::from)));
            }
        }
        result
    }

    pub fn remote_names(&self) -> Vec<String> {
        self.remote_urls().into_iter().map(|(n, _)| n).collect()
    }

    fn stashes(&self) -> Result<Vec<Stash>, String> {
        let out = self.run(&["stash", "list", "-z", "--format=%gd%x1f%H%x1f%ct%x1f%gs"], QUICK)?;
        Ok(out
            .split('\0')
            .filter(|r| !r.trim().is_empty())
            .filter_map(|r| {
                let f: Vec<&str> = r.trim_start_matches('\n').splitn(4, FS).collect();
                let index = f.first()?.trim_start_matches("stash@{").trim_end_matches('}').parse().ok()?;
                Some(Stash { index, sha: f.get(1)?.to_string(), time: f.get(2)?.parse().unwrap_or(0), message: f.get(3).unwrap_or(&"").to_string() })
            })
            .collect())
    }

    pub fn log(&self, q: &LogQuery) -> Result<Vec<Commit>, String> {
        let mut args: Vec<String> = vec![
            "log".into(),
            "-z".into(),
            "--date-order".into(),
            "--decorate=full".into(),
            format!("--format={LOG_FORMAT}"),
            format!("--skip={}", q.skip),
            format!("--max-count={}", q.limit.clamp(1, 5000)),
        ];
        if let Some(m) = q.message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
            args.extend(["--regexp-ignore-case".into(), "--fixed-strings".into(), format!("--grep={m}")]);
        }
        if let Some(a) = q.author.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
            args.extend(["--regexp-ignore-case".into(), "--fixed-strings".into(), format!("--author={a}")]);
        }
        match &q.scope {
            LogScope::All => {
                if self.has_head() {
                    args.push("HEAD".into());
                }
                args.extend(["--branches".into(), "--remotes".into(), "--tags".into()]);
            }
            LogScope::Current => {
                if !self.has_head() {
                    return Ok(Vec::new());
                }
                args.push("HEAD".into());
            }
            LogScope::Revs { revs } => {
                for r in revs {
                    args.push(check_rev(r)?.to_string());
                }
            }
        }
        args.push("--".into());
        if let Some(p) = q.path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            args.push(p.to_string());
        }
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        Ok(parse_log(&self.run(&refs, SLOW)?))
    }

    pub(crate) fn has_head(&self) -> bool {
        self.run(&["rev-parse", "--verify", "--quiet", "HEAD"], QUICK).is_ok_and(|s| !s.trim().is_empty())
    }

    pub fn commit(&self, sha: &str) -> Result<CommitDetail, String> {
        let sha = check_rev(sha)?;
        let out = self.run(&["show", "-s", "-z", "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B", sha, "--"], QUICK)?;
        let f: Vec<&str> = out.splitn(9, '\0').collect();
        if f.len() < 9 {
            return Err(format!("커밋을 읽지 못했습니다: {sha}"));
        }
        let parents: Vec<String> = f[1].split_whitespace().map(String::from).collect();
        let files = self.changed_files(&f[0], parents.first().map(String::as_str))?;
        Ok(CommitDetail {
            sha: f[0].into(),
            parents,
            author: f[2].into(),
            email: f[3].into(),
            time: f[4].parse().unwrap_or(0),
            committer: f[5].into(),
            committer_email: f[6].into(),
            commit_time: f[7].parse().unwrap_or(0),
            message: f[8].trim_end_matches(['\0', '\n']).to_string(),
            files,
        })
    }

    /// `to`가 `from`(없으면 빈 트리·루트 커밋)에서 바꾼 파일들
    pub fn changed_files(&self, to: &str, from: Option<&str>) -> Result<Vec<FileChange>, String> {
        let to = check_rev(to)?;
        let out = match from {
            Some(from) => self.run(&["diff-tree", "-r", "-M", "--raw", "--numstat", "-z", check_rev(from)?, to, "--"], SLOW)?,
            None => self.run(&["diff-tree", "--root", "--no-commit-id", "-r", "-M", "--raw", "--numstat", "-z", to, "--"], SLOW)?,
        };
        let tokens: Vec<&str> = out.split('\0').collect();
        Ok(parse_raw_numstat(&tokens))
    }

    pub fn empty_tree(&self) -> Result<String, String> {
        Ok(self.run(&["hash-object", "-t", "tree", "--stdin"], QUICK)?.trim().to_string())
    }

    pub fn diff(&self, target: &DiffTarget, opts: &DiffOptions) -> Result<TextBlob, String> {
        let mut args: Vec<String> = vec!["diff".into(), "--no-ext-diff".into(), "--no-color".into(), "-M".into()];
        if opts.ignore_whitespace {
            args.push("-w".into());
        }
        if let Some(c) = opts.context {
            args.push(format!("-U{}", c.min(10000)));
        }
        let mut ok_codes: &[i32] = &[];
        match target {
            DiffTarget::Worktree { path, untracked } => {
                let path = check_path(path)?;
                if *untracked {
                    args.extend(["--no-index".into(), "--".into(), "/dev/null".into(), path.into()]);
                    ok_codes = &[1];
                } else {
                    args.extend(["--".into(), path.into()]);
                }
            }
            DiffTarget::Staged { path, old_path } => {
                args.extend(["--cached".into(), "--".into()]);
                push_paths(&mut args, path, old_path.as_deref())?;
            }
            DiffTarget::Commit { sha, path, old_path } => {
                let sha = check_rev(sha)?;
                let parent = self.run(&["rev-parse", "--verify", "--quiet", &format!("{sha}^1")], QUICK).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
                let from = match parent {
                    Some(p) => p,
                    None => self.empty_tree()?,
                };
                args.extend([from, sha.to_string(), "--".into()]);
                push_paths(&mut args, path, old_path.as_deref())?;
            }
            DiffTarget::Range { from, to, path, old_path } => {
                let from = match from {
                    Some(f) => check_rev(f)?.to_string(),
                    None => self.empty_tree()?,
                };
                args.extend([from, check_rev(to)?.to_string(), "--".into()]);
                push_paths(&mut args, path, old_path.as_deref())?;
            }
            DiffTarget::Blobs { a_rev, a_path, b_rev, b_path } => {
                args.push(format!("{}:{}", check_rev(a_rev)?, check_path(a_path)?));
                args.push(format!("{}:{}", check_rev(b_rev)?, check_path(b_path)?));
            }
            DiffTarget::RevToWorktree { rev, rev_path, path } => {
                let rev = check_rev(rev)?;
                if rev_path == path {
                    args.extend([rev.to_string(), "--".into(), check_path(path)?.into()]);
                } else {
                    // 경로가 바뀐 경우: 그 버전 파일과 지금 파일을 직접 비교
                    let blob = self.run(&["rev-parse", "--verify", &format!("{rev}:{}", check_path(rev_path)?)], QUICK)?.trim().to_string();
                    let tmp = std::env::temp_dir().join(format!("nanogit-{}-{}", std::process::id(), blob));
                    let content = self.run_raw(&["cat-file", "blob", &blob], None, SLOW, &[])?.stdout;
                    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
                    let file = self.root().join(check_path(path)?);
                    let r = self.run_raw(
                        &["diff", "--no-index", "--no-color", "--", &tmp.to_string_lossy(), &file.to_string_lossy()],
                        None,
                        SLOW,
                        &[1],
                    );
                    let _ = std::fs::remove_file(&tmp);
                    return Ok(to_blob(&r?.stdout, false));
                }
            }
        }
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = self.run_raw(&refs, None, SLOW, ok_codes)?;
        Ok(to_blob(&out.stdout, out.truncated))
    }

    /// 파일 내용. `rev`가 없으면 작업 트리의 파일
    pub fn file_content(&self, path: &str, rev: Option<&str>) -> Result<TextBlob, String> {
        let path = check_path(path)?;
        let bytes = match rev {
            Some(rev) => self.run_raw(&["show", &format!("{}:{}", check_rev(rev)?, path)], None, SLOW, &[])?.stdout,
            None => std::fs::read(self.root().join(path)).map_err(|e| format!("파일을 읽지 못했습니다: {path} ({e})"))?,
        };
        Ok(to_blob(&bytes, false))
    }

    pub fn file_history(&self, path: &str, follow: bool, skip: u32, limit: u32, rev: Option<&str>) -> Result<Vec<HistoryEntry>, String> {
        let path = check_path(path)?;
        let mut args: Vec<String> = vec![
            "log".into(),
            "-M".into(),
            "-z".into(),
            "--raw".into(),
            "--numstat".into(),
            format!("--format=%x1e{PLAIN_FORMAT}"),
            format!("--skip={skip}"),
            format!("--max-count={}", limit.clamp(1, 5000)),
        ];
        if follow {
            args.push("--follow".into());
        }
        match rev {
            Some(r) => args.push(check_rev(r)?.into()),
            None if !self.has_head() => return Ok(Vec::new()),
            None => args.push("HEAD".into()),
        }
        args.extend(["--".into(), path.into()]);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        Ok(parse_file_history(&self.run(&refs, SLOW)?, path))
    }

    pub fn blame(&self, path: &str, rev: Option<&str>) -> Result<Blame, String> {
        let path = check_path(path)?;
        let mut args = vec!["blame", "--porcelain", "-M"];
        let rev = rev.map(check_rev).transpose()?;
        if let Some(r) = rev {
            args.push(r);
        }
        args.extend(["--", path]);
        let out = self.run_raw(&args, None, SLOW, &[])?;
        let (text, enc) = decode(&out.stdout);
        Ok(parse_blame(&text, enc))
    }

    pub fn line_history(&self, path: &str, start: u32, end: u32, rev: Option<&str>) -> Result<Vec<LineHistoryEntry>, String> {
        let path = check_path(path)?;
        if start == 0 || end < start {
            return Err("줄 범위가 올바르지 않습니다.".into());
        }
        let range = format!("-L{start},{end}:{path}");
        let fmt = format!("--format=%x1e{PLAIN_FORMAT}");
        let mut args = vec!["log", "--no-color", fmt.as_str(), range.as_str(), "--max-count=300"];
        let rev = rev.map(check_rev).transpose()?;
        if let Some(r) = rev {
            args.push(r);
        }
        let out = self.run_raw(&args, None, SLOW, &[])?;
        Ok(parse_line_log(&decode(&out.stdout).0))
    }

    /// 추적 중인 파일 목록 (`rev`가 있으면 그 커밋의 파일)
    pub fn files(&self, rev: Option<&str>) -> Result<Vec<String>, String> {
        let out = match rev {
            Some(r) => self.run(&["ls-tree", "-r", "-z", "--name-only", check_rev(r)?], SLOW)?,
            None => self.run(&["ls-files", "-z"], SLOW)?,
        };
        Ok(out.split('\0').filter(|p| !p.is_empty()).map(String::from).collect())
    }

    /// push 대기 커밋. `all`이면 대기 커밋이 있는 모든 로컬 브랜치
    pub fn outgoing(&self, all: bool) -> Result<Vec<OutgoingBranch>, String> {
        let refs = self.refs()?;
        let remotes = self.remote_names();
        let mut result = Vec::new();
        let mut candidates: Vec<&Branch> = refs.branches.iter().filter(|b| b.current).collect();
        if all {
            candidates.extend(refs.branches.iter().filter(|b| !b.current).take(50));
        }
        for b in candidates {
            let ob = self.outgoing_branch(b, &refs, &remotes)?;
            if b.current || !ob.commits.is_empty() {
                result.push(ob);
            }
        }
        Ok(result)
    }

    fn outgoing_branch(&self, b: &Branch, refs: &Refs, remotes: &[String]) -> Result<OutgoingBranch, String> {
        let has_remote_branch = |name: &str| refs.remotes.iter().any(|r| r.branches.iter().any(|rb| rb.name == name));
        let configured_remote = self.run(&["config", "--get", &format!("branch.{}.remote", b.name)], QUICK).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let remote = configured_remote
            .or_else(|| remotes.iter().find(|r| *r == "origin").cloned())
            .or_else(|| remotes.first().cloned());
        // 추적 브랜치 → 같은 이름의 원격 브랜치 → 새 브랜치
        let existing = b
            .upstream
            .clone()
            .filter(|u| has_remote_branch(u))
            .or_else(|| remote.as_ref().map(|r| format!("{r}/{}", b.name)).filter(|n| has_remote_branch(n)));
        let tip = format!("refs/heads/{}", b.name);
        let (range, new_branch, target): (Vec<String>, bool, Option<String>) = match &existing {
            Some(t) => (vec![format!("refs/remotes/{t}..{tip}")], false, Some(t.clone())),
            None => {
                // 그 원격의 어떤 브랜치에도 없는 커밋
                let r = match &remote {
                    Some(rm) => vec![tip.clone(), "--not".into(), format!("--remotes={rm}")],
                    None => vec![tip.clone()],
                };
                (r, true, remote.as_ref().map(|r| format!("{r}/{}", b.name)))
            }
        };
        let fmt = format!("--format={LOG_FORMAT}");
        let max = format!("--max-count={}", MAX_OUTGOING + 1);
        let mut args = vec!["log", "-z", "--topo-order", "--decorate=full", fmt.as_str(), max.as_str()];
        args.extend(range.iter().map(String::as_str));
        args.push("--");
        let mut commits = parse_log(&self.run(&args, SLOW)?);
        let truncated = commits.len() > MAX_OUTGOING as usize;
        commits.truncate(MAX_OUTGOING as usize);

        let behind = match &existing {
            Some(t) => self
                .run(&["rev-list", "--count", &format!("{tip}..refs/remotes/{t}"), "--"], QUICK)
                .ok()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0),
            None => 0,
        };

        // 합친 변경: 원격 브랜치와 갈라진 지점 → 브랜치 끝. 새 브랜치면 가장 오래된 대기 커밋의 부모
        let base = if commits.is_empty() {
            None
        } else {
            match &existing {
                Some(t) => self.run(&["merge-base", &format!("refs/remotes/{t}"), &tip], QUICK).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                None => commits.last().and_then(|c| c.parents.first().cloned()),
            }
        };
        let files = if commits.is_empty() {
            Vec::new()
        } else {
            match &base {
                Some(base) => self.changed_files(&tip, Some(base))?,
                None => {
                    let empty = self.empty_tree()?;
                    self.changed_files(&tip, Some(&empty))?
                }
            }
        };
        Ok(OutgoingBranch { branch: b.name.clone(), current: b.current, remote, target, new_branch, base, commits, files, behind, truncated })
    }

    /// 커밋들의 제목 (사라진 커밋은 빠진다)
    pub fn subjects(&self, shas: &[String]) -> HashMap<String, String> {
        if shas.is_empty() {
            return HashMap::new();
        }
        let input: String = shas.iter().map(|s| format!("{s}\n")).collect();
        match self.run_raw(&["cat-file", "--batch"], Some(input.as_bytes()), SLOW, &[]) {
            Ok(out) => parse_cat_file_subjects(&out.stdout).into_iter().collect(),
            Err(_) => HashMap::new(),
        }
    }

    /// `old`에서 닿지만 `new`에서 닿지 않는 커밋 수 (버려진 커밋)
    pub fn dropped_count(&self, old: &str, new: &str) -> u32 {
        self.run(&["rev-list", "--count", &format!("{new}..{old}"), "--"], QUICK).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
    }

    pub fn fetch(&self) -> Result<String, String> {
        self.run_verbose(&["fetch", "--all", "--prune", "--no-write-fetch-head"], NETWORK)
    }

    /// 커밋을 가진 브랜치 이름들 (로컬·원격)
    pub fn branches_containing(&self, sha: &str) -> Result<Vec<String>, String> {
        let out = self.run(&["for-each-ref", "--format=%(refname)", &format!("--contains={}", check_rev(sha)?), "refs/heads", "refs/remotes"], SLOW)?;
        let set: HashSet<String> = out
            .lines()
            .filter(|l| !l.ends_with("/HEAD"))
            .map(|l| l.trim_start_matches("refs/heads/").trim_start_matches("refs/remotes/").to_string())
            .collect();
        let mut v: Vec<String> = set.into_iter().collect();
        v.sort();
        Ok(v)
    }
}

fn push_paths(args: &mut Vec<String>, path: &str, old_path: Option<&str>) -> Result<(), String> {
    if let Some(old) = old_path.filter(|o| *o != path) {
        args.push(check_path(old)?.into());
    }
    args.push(check_path(path)?.into());
    Ok(())
}

fn to_blob(bytes: &[u8], truncated: bool) -> TextBlob {
    let size = bytes.len() as u64;
    let head = &bytes[..bytes.len().min(8000)];
    // diff 출력에서 git이 이진 파일이라고 알려 주는 경우, 또는 파일 내용에 NUL이 있는 경우
    let binary = head.contains(&0);
    if binary {
        return TextBlob { text: String::new(), binary: true, truncated, encoding: "binary".into(), size };
    }
    let cut = bytes.len() > MAX_TEXT;
    let slice = if cut { &bytes[..MAX_TEXT] } else { bytes };
    let (text, enc) = decode(slice);
    TextBlob { text, binary: false, truncated: truncated || cut, encoding: enc.into(), size }
}

fn mtime_ms(p: &Path) -> Option<i64> {
    let m = std::fs::metadata(p).ok()?.modified().ok()?;
    let d = m.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(d.as_millis()).ok()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::find_git;
    use super::*;
    use std::process::Command;

    /// 실제 git으로 저장소를 만들어 조회 전체를 확인한다 (git이 없으면 건너뜀)
    pub(crate) fn sh(dir: &Path, args: &[&str]) {
        let exe = find_git().unwrap();
        let out = Command::new(exe)
            .args(["-c", "user.name=홍길동", "-c", "user.email=hong@example.com", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"])
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    #[test]
    fn queries_with_real_git() {
        if find_git().is_err() {
            eprintln!("git이 없어 건너뜀");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let upstream = tmp.path().join("upstream");
        std::fs::create_dir_all(&upstream).unwrap();
        sh(&upstream, &["init", "-q", "--bare"]);

        let work = tmp.path().join("work");
        sh(tmp.path(), &["clone", "-q", upstream.to_str().unwrap(), "work"]);
        const V1: &str = "a\nb\nc\nx1\nx2\nx3\nx4\nx5\n";
        std::fs::write(work.join("auth.ts"), V1).unwrap();
        std::fs::write(work.join("메모.txt"), "처음\n").unwrap();
        sh(&work, &["add", "."]);
        sh(&work, &["commit", "-q", "-m", "처음 커밋"]);
        sh(&work, &["push", "-q", "-u", "origin", "main"]);

        std::fs::write(work.join("auth.ts"), "a\nb2\nc\nx1\nx2\nx3\nx4\nx5\nd\n").unwrap();
        sh(&work, &["commit", "-q", "-am", "auth 수정"]);
        sh(&work, &["mv", "auth.ts", "login.ts"]);
        sh(&work, &["commit", "-q", "-m", "이름 변경"]);
        sh(&work, &["tag", "v0.1"]);

        let git = Git::open(&work).unwrap();

        // 히스토리: 모든 브랜치, 참조 배지
        let log = git.log(&LogQuery { scope: LogScope::All, skip: 0, limit: 100, message: None, author: None, path: None }).unwrap();
        assert_eq!(log.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), vec!["이름 변경", "auth 수정", "처음 커밋"]);
        assert!(log[0].refs.iter().any(|r| r.kind == RefKind::Head && r.name == "main"));
        assert!(log[0].refs.iter().any(|r| r.kind == RefKind::Tag && r.name == "v0.1"));
        assert!(log[2].refs.iter().any(|r| r.kind == RefKind::Remote && r.name == "origin/main"));
        let found = git.log(&LogQuery { scope: LogScope::Current, skip: 0, limit: 10, message: Some("AUTH".into()), author: None, path: None }).unwrap();
        assert_eq!(found.len(), 1);
        assert!(git.log(&LogQuery { scope: LogScope::Revs { revs: vec!["--output=x".into()] }, skip: 0, limit: 1, message: None, author: None, path: None }).is_err());

        // 커밋 상세: 이름 변경
        let d = git.commit(&log[0].sha).unwrap();
        assert_eq!(d.files.len(), 1);
        assert_eq!((d.files[0].status.as_str(), d.files[0].old_path.as_deref()), ("R", Some("auth.ts")));
        // 루트 커밋
        let root = git.commit(&log[2].sha).unwrap();
        assert_eq!(root.files.len(), 2);

        // diff
        let diff = git.diff(&DiffTarget::Commit { sha: log[1].sha.clone(), path: "auth.ts".into(), old_path: None }, &DiffOptions::default()).unwrap();
        assert!(diff.text.contains("-b\n+b2"), "{}", diff.text);
        let diff = git.diff(&DiffTarget::Commit { sha: log[2].sha.clone(), path: "메모.txt".into(), old_path: None }, &DiffOptions::default()).unwrap();
        assert!(diff.text.contains("+처음"));

        // push 대기: 커밋 2개, 합친 변경은 이름 바뀐 파일 하나
        let out = git.outgoing(false).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].target.as_deref(), Some("origin/main"));
        assert_eq!(out[0].commits.len(), 2);
        assert!(!out[0].new_branch);
        assert_eq!(out[0].files.len(), 1);
        assert_eq!(out[0].files[0].path, "login.ts");
        assert_eq!(out[0].files[0].old_path.as_deref(), Some("auth.ts"));

        // 새 브랜치: 원격에 없는 커밋만
        sh(&work, &["switch", "-q", "-c", "feature/새기능"]);
        std::fs::write(work.join("new.ts"), "x\n").unwrap();
        sh(&work, &["add", "."]);
        sh(&work, &["commit", "-q", "-m", "새 기능"]);
        let out = git.outgoing(false).unwrap();
        assert!(out[0].new_branch);
        assert_eq!(out[0].target.as_deref(), Some("origin/feature/새기능"));
        assert_eq!(out[0].commits.len(), 3, "origin에 없는 커밋 전부");
        let all = git.outgoing(true).unwrap();
        assert_eq!(all.len(), 2);

        // 파일 이력: 이름 변경 추적
        let h = git.file_history("login.ts", true, 0, 100, None).unwrap();
        assert_eq!(h.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["login.ts", "auth.ts", "auth.ts"]);
        assert_eq!(h[0].old_path.as_deref(), Some("auth.ts"));
        let h = git.file_history("login.ts", false, 0, 100, None).unwrap();
        assert_eq!(h.len(), 1);

        // 두 버전 비교 (경로가 다름)
        let blobs = git
            .diff(&DiffTarget::Blobs { a_rev: log[2].sha.clone(), a_path: "auth.ts".into(), b_rev: "HEAD".into(), b_path: "login.ts".into() }, &DiffOptions::default())
            .unwrap();
        assert!(blobs.text.contains("+d"));

        // 내용, blame, 줄 이력
        assert_eq!(git.file_content("auth.ts", Some(&log[2].sha)).unwrap().text, V1);
        let blame = git.blame("login.ts", None).unwrap();
        assert_eq!(blame.lines.len(), 9);
        assert_eq!(blame.commits[blame.lines[1].c].summary, "auth 수정");
        let lh = git.line_history("login.ts", 2, 2, None).unwrap();
        assert_eq!(lh.len(), 2);
        assert_eq!(git.files(None).unwrap(), vec!["login.ts", "new.ts", "메모.txt"]);

        // 작업 트리 상태: 수정·추적 안 함·스테이지
        std::fs::write(work.join("login.ts"), "changed\n").unwrap();
        std::fs::write(work.join("새 파일.txt"), "new\n").unwrap();
        std::fs::write(work.join("메모.txt"), "스테이지\n").unwrap();
        sh(&work, &["add", "메모.txt"]);
        let s = git.status().unwrap();
        assert_eq!(s.branch.as_deref(), Some("feature/새기능"));
        assert_eq!(s.staged.len(), 1);
        assert_eq!(s.unstaged.len(), 2);
        assert!(s.unstaged.iter().all(|f| f.mtime.is_some()));
        let d = git.diff(&DiffTarget::Worktree { path: "새 파일.txt".into(), untracked: true }, &DiffOptions::default()).unwrap();
        assert!(d.text.contains("+new"), "{}", d.text);
        let d = git.diff(&DiffTarget::Staged { path: "메모.txt".into(), old_path: None }, &DiffOptions::default()).unwrap();
        assert!(d.text.contains("+스테이지"));
        let d = git.diff(&DiffTarget::RevToWorktree { rev: log[2].sha.clone(), rev_path: "auth.ts".into(), path: "login.ts".into() }, &DiffOptions::default()).unwrap();
        assert!(d.text.contains("+changed"), "{}", d.text);

        // 참조
        let refs = git.refs().unwrap();
        assert_eq!(refs.branches.len(), 2);
        assert!(refs.branches.iter().any(|b| b.name == "main" && b.ahead == Some(2) && b.upstream.as_deref() == Some("origin/main")));
        assert_eq!(refs.remotes[0].name, "origin");
        assert_eq!(refs.tags[0].name, "v0.1");
        assert!(git.branches_containing(&log[2].sha).unwrap().contains(&"origin/main".to_string()));
    }

    #[test]
    fn cp949_file_content() {
        if find_git().is_err() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        sh(tmp.path(), &["init", "-q"]);
        std::fs::write(tmp.path().join("legacy.txt"), [0xC7u8, 0xD1, 0xB1, 0xDB, b'\n']).unwrap();
        sh(tmp.path(), &["add", "."]);
        sh(tmp.path(), &["commit", "-q", "-m", "legacy"]);
        let git = Git::open(tmp.path()).unwrap();
        let blob = git.file_content("legacy.txt", Some("HEAD")).unwrap();
        assert_eq!((blob.text.as_str(), blob.encoding.as_str()), ("한글\n", "cp949"));
    }
}
