//! 활동 타임라인: git이 남기는 reflog 파일을 직접 읽어 시간순으로 합친다.
//!
//! `.git/logs/HEAD`(체크아웃·분리된 HEAD), `.git/logs/refs/heads/**`(브랜치), `.git/logs/refs/remotes/**`(push·fetch),
//! `.git/logs/refs/stash`. 같은 작업이 HEAD와 브랜치 reflog에 함께 남으면 브랜치 쪽 하나만 남긴다.

use std::path::Path;

use super::Git;
use super::model::ActivityEntry;
use super::parse::parse_reflog_line;

/// 버려진 커밋 수를 셀 최근 항목 수 (git을 항목마다 한 번씩 실행한다)
const DROP_CHECK: usize = 120;

fn is_zero(sha: &str) -> bool {
    sha.bytes().all(|b| b == b'0')
}

/// 버려진 커밋이 생길 수 있는 작업 (amend·reset·rebase·강제 push·강제 fetch)
fn may_drop(ref_name: &str, message: &str) -> bool {
    if ref_name.starts_with("refs/remotes/") {
        return true; // push·fetch: 이전 위치가 새 위치의 조상인지 확인
    }
    message.starts_with("reset:") || message.starts_with("commit (amend)") || message.starts_with("rebase") || message.starts_with("pull --rebase")
}

pub fn read_entries(common_dir: &Path, git_dir: &Path, since: i64) -> Vec<ActivityEntry> {
    let mut files: Vec<(String, std::path::PathBuf)> = vec![("HEAD".into(), git_dir.join("logs").join("HEAD"))];
    let logs = common_dir.join("logs");
    collect(&logs.join("refs").join("heads"), "refs/heads", &mut files);
    collect(&logs.join("refs").join("remotes"), "refs/remotes", &mut files);
    files.push(("refs/stash".into(), logs.join("refs").join("stash")));

    let mut entries = Vec::new();
    for (ref_name, path) in files {
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        for line in text.lines() {
            let Some(l) = parse_reflog_line(line) else { continue };
            if l.time < since {
                continue;
            }
            entries.push(ActivityEntry {
                time: l.time,
                ref_name: ref_name.clone(),
                old: l.old,
                new: l.new,
                message: l.message,
                who: l.who,
                subject: None,
                old_subject: None,
                dropped: 0,
            });
        }
    }
    dedupe(&mut entries);
    // 최근 것이 위로. 같은 시각(초)이면 파일에서 나중 줄이 위로 오게 뒤집은 뒤 안정 정렬
    entries.reverse();
    entries.sort_by(|a, b| b.time.cmp(&a.time));
    entries
}

fn collect(dir: &Path, prefix: &str, out: &mut Vec<(String, std::path::PathBuf)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let full = format!("{prefix}/{name}");
        if p.is_dir() {
            collect(&p, &full, out);
        } else if !full.ends_with("/HEAD") {
            out.push((full, p));
        }
    }
}

/// HEAD와 브랜치 reflog에 함께 남은 같은 작업은 브랜치 쪽만 남긴다
fn dedupe(entries: &mut Vec<ActivityEntry>) {
    let branch_keys: std::collections::HashSet<(String, String, i64)> = entries
        .iter()
        .filter(|e| e.ref_name.starts_with("refs/heads/"))
        .map(|e| (e.old.clone(), e.new.clone(), e.time))
        .collect();
    entries.retain(|e| e.ref_name != "HEAD" || !branch_keys.contains(&(e.old.clone(), e.new.clone(), e.time)));
}

impl Git {
    /// 활동 타임라인 (최근 것부터 `limit`개)
    pub fn activity(&self, since: i64, limit: usize) -> Vec<ActivityEntry> {
        let mut entries = read_entries(&self.loc.common_dir, &self.loc.git_dir, since);
        entries.truncate(limit);
        let mut shas: Vec<String> = Vec::new();
        for e in &entries {
            for s in [&e.new, &e.old] {
                if !is_zero(s) && !shas.contains(s) {
                    shas.push(s.clone());
                }
            }
        }
        let subjects = self.subjects(&shas);
        let mut checked = 0;
        for e in entries.iter_mut() {
            e.subject = subjects.get(&e.new).cloned();
            e.old_subject = subjects.get(&e.old).cloned();
            if checked < DROP_CHECK && !is_zero(&e.old) && !is_zero(&e.new) && e.old != e.new && may_drop(&e.ref_name, &e.message) {
                checked += 1;
                // 이전 커밋이 이미 지워졌으면(gc) 셀 수 없다
                if subjects.contains_key(&e.old) {
                    e.dropped = self.dropped_count(&e.old, &e.new);
                }
            }
        }
        entries
    }
}

#[cfg(test)]
mod tests {
    use super::super::find_git;
    use super::super::query::tests::sh;
    use super::*;

    #[test]
    fn timeline_with_real_git() {
        if find_git().is_err() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let upstream = tmp.path().join("up.git");
        std::fs::create_dir_all(&upstream).unwrap();
        sh(&upstream, &["init", "-q", "--bare"]);
        let work = tmp.path().join("work");
        sh(tmp.path(), &["clone", "-q", upstream.to_str().unwrap(), "work"]);
        // 원격 추적 브랜치 reflog를 남긴다 (bare 저장소에서 clone하면 기본으로 켜짐)
        for (i, msg) in ["하나", "둘", "셋"].iter().enumerate() {
            std::fs::write(work.join("a.txt"), format!("{i}\n")).unwrap();
            sh(&work, &["add", "."]);
            sh(&work, &["commit", "-q", "-m", msg]);
        }
        sh(&work, &["push", "-q", "-u", "origin", "main"]);
        sh(&work, &["commit", "-q", "--amend", "-m", "셋 고침"]);
        sh(&work, &["reset", "-q", "--hard", "HEAD~1"]);
        sh(&work, &["push", "-q", "--force", "origin", "main"]);

        let git = Git::open(&work).unwrap();
        let a = git.activity(0, 100);
        let msgs: Vec<&str> = a.iter().map(|e| e.message.as_str()).collect();
        assert!(msgs.iter().any(|m| m.starts_with("reset: moving to HEAD~1")), "{msgs:?}");
        assert!(msgs.iter().any(|m| m.starts_with("commit (amend)")), "{msgs:?}");

        let reset = a.iter().find(|e| e.message.starts_with("reset:")).unwrap();
        assert_eq!(reset.ref_name, "refs/heads/main", "HEAD 중복은 브랜치 쪽으로 합침");
        assert_eq!(reset.dropped, 1);
        assert_eq!(reset.old_subject.as_deref(), Some("셋 고침"));
        assert_eq!(reset.subject.as_deref(), Some("둘"));

        let amend = a.iter().find(|e| e.message.starts_with("commit (amend)")).unwrap();
        assert_eq!(amend.dropped, 1);

        // 강제 push: origin/main이 "셋"에서 "둘"로 되돌아감
        let pushes: Vec<&ActivityEntry> = a.iter().filter(|e| e.ref_name == "refs/remotes/origin/main").collect();
        assert!(pushes.len() >= 2, "{pushes:?}");
        assert!(pushes[0].message.contains("push"));
        assert_eq!(pushes[0].dropped, 1, "강제 push로 원격에서 사라진 커밋");

        // 최근 것이 위로
        assert!(a.windows(2).all(|w| w[0].time >= w[1].time));
    }
}
