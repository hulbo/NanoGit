//! 저장소 실시간 감시.
//!
//! 저장소 폴더를 파일 시스템 감시로 보고, 바뀐 경로가 git 디렉터리 안이면 "git 상태 변화",
//! 밖이면 "작업 트리 변화"로 나눠 알린다. 짧은 시간에 몰리는 변경은 묶어서
//! (조용해진 뒤 300ms, 계속 바뀌어도 최대 1초에 한 번) 저장소마다 한 번만 알린다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use crate::git::{display, find_repo, norm};

const QUIET: Duration = Duration::from_millis(300);
const MAX_WAIT: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub root: String,
    /// 작업 트리 파일이 바뀜
    pub worktree: bool,
    /// HEAD·index·refs·reflog가 바뀜 (커밋, 브랜치 전환, push, fetch …)
    pub git: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Worktree,
    Git,
}

/// 감시 중인 저장소의 경로들
#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
    pub git_dirs: Vec<PathBuf>,
}

/// 바뀐 경로가 무엇에 해당하는지. 무시할 변경이면 None
pub fn classify(paths: &Paths, p: &Path) -> Option<Kind> {
    for g in &paths.git_dirs {
        if let Ok(rel) = p.strip_prefix(g) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            // 객체 파일·잠금 파일·임시 파일은 잡음
            if rel.starts_with("objects") || rel.ends_with(".lock") || rel.starts_with("fsmonitor") || rel.contains("/tmp_") || rel == "FETCH_HEAD.tmp" {
                return None;
            }
            return Some(Kind::Git);
        }
    }
    let rel = p.strip_prefix(&paths.root).ok()?;
    if rel.components().next().is_some_and(|c| c.as_os_str() == ".git") {
        return None; // git 디렉터리가 다른 곳에 있는 저장소의 .git 파일 등
    }
    Some(Kind::Worktree)
}

struct RepoWatch {
    _watchers: Vec<RecommendedWatcher>,
}

pub struct WatchHub {
    repos: Mutex<HashMap<String, RepoWatch>>,
    tx: Mutex<Sender<(String, Kind)>>,
}

impl WatchHub {
    pub fn new(emit: Arc<dyn Fn(Change) + Send + Sync>) -> Arc<Self> {
        let (tx, rx) = mpsc::channel::<(String, Kind)>();
        std::thread::Builder::new()
            .name("watch-dispatch".into())
            .spawn(move || {
                let mut pending: HashMap<String, (Change, Instant, Instant)> = HashMap::new();
                loop {
                    match rx.recv_timeout(Duration::from_millis(100)) {
                        Ok((root, kind)) => {
                            let now = Instant::now();
                            let e = pending.entry(root.clone()).or_insert_with(|| (Change { root, worktree: false, git: false }, now, now));
                            match kind {
                                Kind::Worktree => e.0.worktree = true,
                                Kind::Git => e.0.git = true,
                            }
                            e.2 = now;
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                    let now = Instant::now();
                    let due: Vec<String> = pending
                        .iter()
                        .filter(|(_, (_, first, last))| now.duration_since(*last) >= QUIET || now.duration_since(*first) >= MAX_WAIT)
                        .map(|(k, _)| k.clone())
                        .collect();
                    for k in due {
                        if let Some((change, _, _)) = pending.remove(&k) {
                            emit(change);
                        }
                    }
                }
            })
            .ok();
        Arc::new(WatchHub { repos: Mutex::new(HashMap::new()), tx: Mutex::new(tx) })
    }

    /// 감시할 저장소 목록을 맞춘다. 감시를 시작하지 못한 저장소는 오류 메시지로 돌려준다.
    pub fn set(&self, roots: &[String]) -> Vec<String> {
        let mut errors = Vec::new();
        let Ok(mut repos) = self.repos.lock() else { return errors };
        let wanted: HashMap<String, &String> = roots.iter().map(|r| (norm(Path::new(r)), r)).collect();
        repos.retain(|k, _| wanted.contains_key(k));
        for (key, root) in wanted {
            if repos.contains_key(&key) {
                continue;
            }
            match self.watch_one(root) {
                Ok(w) => {
                    repos.insert(key, w);
                }
                Err(e) => errors.push(format!("{root}: {e}")),
            }
        }
        errors
    }

    fn watch_one(&self, root: &str) -> Result<RepoWatch, String> {
        let loc = find_repo(Path::new(root)).ok_or("git 저장소가 아닙니다")?;
        let mut git_dirs = vec![loc.git_dir.clone()];
        if loc.common_dir != loc.git_dir {
            git_dirs.push(loc.common_dir.clone());
        }
        let paths = Paths { root: loc.root.clone(), git_dirs: git_dirs.clone() };
        let tx = self.tx.lock().map_err(|e| e.to_string())?.clone();
        let name = display(&loc.root);
        let handler = move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            if matches!(ev.kind, EventKind::Access(_)) {
                return;
            }
            if ev.need_rescan() {
                let _ = tx.send((name.clone(), Kind::Worktree));
                let _ = tx.send((name.clone(), Kind::Git));
                return;
            }
            for p in &ev.paths {
                if let Some(kind) = classify(&paths, p) {
                    let _ = tx.send((name.clone(), kind));
                }
            }
        };
        let mut main = notify::recommended_watcher(handler.clone()).map_err(|e| e.to_string())?;
        main.watch(&loc.root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
        let mut watchers = vec![main];
        // git 디렉터리가 작업 트리 밖에 있으면(linked worktree) 따로 본다
        for g in git_dirs.iter().filter(|g| !g.starts_with(&loc.root)) {
            let mut w = notify::recommended_watcher(handler.clone()).map_err(|e| e.to_string())?;
            if w.watch(g, RecursiveMode::Recursive).is_ok() {
                watchers.push(w);
            }
        }
        Ok(RepoWatch { _watchers: watchers })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_paths() {
        let root = PathBuf::from("C:/p/app");
        let paths = Paths { root: root.clone(), git_dirs: vec![root.join(".git")] };
        assert_eq!(classify(&paths, &root.join("src/main.ts")), Some(Kind::Worktree));
        assert_eq!(classify(&paths, &root.join(".git/HEAD")), Some(Kind::Git));
        assert_eq!(classify(&paths, &root.join(".git/refs/heads/main")), Some(Kind::Git));
        assert_eq!(classify(&paths, &root.join(".git/objects/ab/cdef")), None);
        assert_eq!(classify(&paths, &root.join(".git/index.lock")), None);
        assert_eq!(classify(&paths, Path::new("C:/other/file")), None);
    }

    #[test]
    fn batches_changes_per_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("repo");
        std::fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let got: Arc<Mutex<Vec<Change>>> = Arc::default();
        let sink = got.clone();
        let hub = WatchHub::new(Arc::new(move |c| sink.lock().unwrap().push(c)));
        let root_s = display(&root);
        assert!(hub.set(std::slice::from_ref(&root_s)).is_empty());
        std::thread::sleep(Duration::from_millis(200));

        for i in 0..5 {
            std::fs::write(root.join(format!("f{i}.txt")), "x").unwrap();
        }
        std::fs::write(root.join(".git/refs/heads/main"), "0000000000000000000000000000000000000000\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        std::thread::sleep(Duration::from_millis(500));
        let changes = got.lock().unwrap().clone();
        assert!(!changes.is_empty(), "변경 알림이 와야 함");
        assert!(changes.len() <= 2, "몰린 변경은 묶여야 함: {changes:?}");
        assert!(changes.iter().all(|c| c.root == root_s));
        assert!(changes.iter().any(|c| c.worktree));
        assert!(changes.iter().any(|c| c.git));

        // 감시를 끄면 더 오지 않는다
        hub.set(&[]);
        got.lock().unwrap().clear();
        std::fs::write(root.join("after.txt"), "x").unwrap();
        std::thread::sleep(Duration::from_millis(700));
        assert!(got.lock().unwrap().is_empty());
    }
}
