//! PC에 설치된 git 명령을 창 없이 실행하고 결과를 읽는다.
//!
//! 조회(`query`, `reflog`)는 저장소를 바꾸지 않고, `GIT_OPTIONAL_LOCKS=0`으로 실행해
//! AI가 실행 중인 git 명령과 `index.lock`으로 부딪히지 않게 한다.
//! 저장소를 바꾸는 조작은 `ops`에만 있고, 사용자가 화면에서 고른 것만 실행한다.

pub mod model;
pub mod ops;
pub mod parse;
pub mod query;
pub mod reflog;

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// 목록·상태처럼 금방 끝나는 명령의 제한 시간
pub const QUICK: Duration = Duration::from_secs(20);
/// log·blame처럼 오래 걸릴 수 있는 조회
pub const SLOW: Duration = Duration::from_secs(60);
/// fetch처럼 네트워크를 쓰는 명령
pub const NETWORK: Duration = Duration::from_secs(180);
/// 출력을 이보다 많이 읽지 않는다 (넘으면 잘림 표시)
const MAX_OUTPUT: usize = 64 * 1024 * 1024;

/// 작업 트리 루트와 git 디렉터리
#[derive(Debug, Clone, PartialEq)]
pub struct RepoLocation {
    pub root: PathBuf,
    /// 이 작업 트리의 git 디렉터리 (linked worktree면 `.git/worktrees/<이름>`)
    pub git_dir: PathBuf,
    /// refs·objects·logs가 있는 공용 git 디렉터리
    pub common_dir: PathBuf,
}

/// `start`에서 위로 올라가며 저장소를 찾는다. `.git`이 파일(worktree·submodule)이면 `gitdir:`을 따라간다.
pub fn find_repo(start: &Path) -> Option<RepoLocation> {
    let mut dir = Some(start);
    while let Some(d) = dir {
        let dot = d.join(".git");
        let git_dir = if dot.is_dir() {
            Some(dot)
        } else if dot.is_file() {
            let text = std::fs::read_to_string(&dot).ok()?;
            let target = text.lines().find_map(|l| l.trim().strip_prefix("gitdir:"))?.trim();
            let p = PathBuf::from(target);
            Some(if p.is_absolute() { p } else { d.join(p) })
        } else {
            None
        };
        if let Some(git_dir) = git_dir {
            let common_dir = std::fs::read_to_string(git_dir.join("commondir"))
                .ok()
                .map(|c| {
                    let p = PathBuf::from(c.trim());
                    if p.is_absolute() { p } else { git_dir.join(p) }
                })
                .unwrap_or_else(|| git_dir.clone());
            return Some(RepoLocation { root: d.to_path_buf(), git_dir, common_dir });
        }
        dir = d.parent();
    }
    None
}

/// 화면에 보여 줄 경로 (`/` 구분, 끝 슬래시 없음)
pub fn display(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    // `C:/` 같은 드라이브 루트는 그대로 둔다
    if s.len() > 3 { s.trim_end_matches('/').to_string() } else { s }
}

/// 경로 비교용 (역슬래시·끝 슬래시·대소문자 무시)
pub fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// PATH와 기본 설치 위치에서 git 실행 파일을 찾는다. 한 번 찾으면 기억한다.
pub fn find_git() -> Result<PathBuf, String> {
    static FOUND: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOUND
        .get_or_init(search_git)
        .clone()
        .ok_or_else(|| "git을 찾지 못했습니다. Git for Windows를 설치하거나 PATH에 git을 추가하세요.".to_string())
}

fn search_git() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "git.exe" } else { "git" };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join(exe);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    #[cfg(windows)]
    for (var, rel) in [
        ("ProgramFiles", r"Git\cmd\git.exe"),
        ("ProgramW6432", r"Git\cmd\git.exe"),
        ("ProgramFiles(x86)", r"Git\cmd\git.exe"),
        ("LOCALAPPDATA", r"Programs\Git\cmd\git.exe"),
    ] {
        if let Some(base) = std::env::var_os(var) {
            let p = PathBuf::from(base).join(rel);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// 바이트를 글자로: UTF-8이 아니면 CP949(한글 Windows 레거시 파일)로 읽는다.
pub fn decode(bytes: &[u8]) -> (String, &'static str) {
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), "utf-8"),
        Err(_) => {
            let (text, _, _) = encoding_rs::EUC_KR.decode(bytes);
            (text.into_owned(), "cp949")
        }
    }
}

/// 리비전 인자 검사: 옵션으로 해석될 수 있는 값(`-`로 시작)과 빈 값을 막는다.
pub fn check_rev(rev: &str) -> Result<&str, String> {
    let r = rev.trim();
    if r.is_empty() || r.starts_with('-') || r.contains('\0') {
        return Err(format!("리비전이 올바르지 않습니다: {rev}"));
    }
    Ok(r)
}

/// 경로 인자 검사 (항상 `--` 뒤에 넘기지만 빈 값과 NUL은 막는다)
pub fn check_path(path: &str) -> Result<&str, String> {
    if path.is_empty() || path.contains('\0') {
        return Err(format!("경로가 올바르지 않습니다: {path}"));
    }
    Ok(path)
}

pub struct RunOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    /// 출력이 너무 커서 일부만 읽음
    pub truncated: bool,
}

struct Exec {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
}

pub struct Git {
    exe: PathBuf,
    pub loc: RepoLocation,
    /// 조작용: 편집기를 띄우지 않는다
    write: bool,
}

impl Git {
    pub fn open(path: &Path) -> Result<Self, String> {
        let loc = find_repo(path).ok_or_else(|| format!("git 저장소가 아닙니다: {}", display(path)))?;
        Ok(Git { exe: find_git()?, loc, write: false })
    }

    /// 저장소를 바꾸는 조작용으로 연다 (`ops`)
    pub fn open_write(path: &Path) -> Result<Self, String> {
        Ok(Git { write: true, ..Self::open(path)? })
    }

    pub fn root(&self) -> &Path {
        &self.loc.root
    }

    /// git을 실행하고 끝날 때까지 기다린다. 실행하지 못했거나 제한 시간을 넘으면 Err
    fn exec(&self, args: &[&str], input: Option<&[u8]>, timeout: Duration) -> Result<Exec, String> {
        let mut cmd = Command::new(&self.exe);
        // 한글 파일 이름을 \353... 같은 이스케이프 없이 받는다
        cmd.args(["-c", "core.quotepath=false", "-c", "color.ui=never", "-c", "log.showSignature=false"])
            .args(args)
            .current_dir(&self.loc.root)
            // 인증 정보를 터미널에서 묻다가 멈추지 않게 한다
            .env("GIT_TERMINAL_PROMPT", "0")
            // 조회가 index.lock을 잡아 다른 git 명령(AI)과 부딪히지 않게 한다
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if self.write {
            // 창 없는 git이 편집기를 기다리며 멈추지 않게 한다
            cmd.env("GIT_EDITOR", "true").env("GIT_SEQUENCE_EDITOR", "true").env("GIT_MERGE_AUTOEDIT", "no");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| format!("git을 실행하지 못했습니다: {e}"))?;
        if let (Some(data), Some(mut stdin)) = (input, child.stdin.take()) {
            let data = data.to_vec();
            std::thread::spawn(move || {
                let _ = stdin.write_all(&data);
            });
        }
        let out = child.stdout.take().ok_or("git 출력을 읽을 수 없습니다")?;
        let mut err = child.stderr.take().ok_or("git 출력을 읽을 수 없습니다")?;
        let full = Arc::new(AtomicBool::new(false));
        let full_r = full.clone();
        let out_t = std::thread::spawn(move || {
            let mut b = Vec::new();
            let mut limited = out.take(MAX_OUTPUT as u64 + 1);
            let _ = limited.read_to_end(&mut b);
            if b.len() > MAX_OUTPUT {
                full_r.store(true, Ordering::SeqCst);
            }
            b
        });
        let err_t = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = err.read_to_end(&mut b);
            b
        });
        let deadline = Instant::now() + timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) if full.load(Ordering::SeqCst) => {
                    // 출력 한도에 닿았으면 더 기다리지 않는다
                    let _ = child.kill();
                    std::thread::sleep(Duration::from_millis(5));
                }
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("git {}이(가) {}초 안에 끝나지 않아 중단했습니다.", args.join(" "), timeout.as_secs()));
                }
                Err(e) => return Err(e.to_string()),
            }
        };
        let mut stdout = out_t.join().unwrap_or_default();
        let truncated = stdout.len() > MAX_OUTPUT;
        if truncated {
            stdout.truncate(MAX_OUTPUT);
        }
        Ok(Exec { status, stdout, stderr: err_t.join().unwrap_or_default(), truncated })
    }

    /// git을 실행하고 표준 출력을 바이트로 돌려준다.
    /// `ok_codes`의 종료 코드도 성공으로 본다 (`diff --no-index`는 차이가 있으면 1).
    pub fn run_raw(&self, args: &[&str], input: Option<&[u8]>, timeout: Duration, ok_codes: &[i32]) -> Result<RunOutput, String> {
        let Exec { status, stdout, stderr, truncated } = self.exec(args, input, timeout)?;
        let stderr = String::from_utf8_lossy(&stderr).trim().to_string();
        let code = status.code();
        if status.success() || truncated || code.is_some_and(|c| ok_codes.contains(&c)) {
            Ok(RunOutput { stdout, stderr, truncated })
        } else {
            let msg = if stderr.is_empty() { String::from_utf8_lossy(&stdout).trim().to_string() } else { stderr };
            Err(if msg.is_empty() { format!("git {} 실패 ({status})", args.join(" ")) } else { msg })
        }
    }

    /// 조작을 실행하고 git이 남긴 글(표준 출력 + 오류)을 돌려준다.
    /// 실패해도 두 출력을 합쳐 돌려준다 (병합 충돌 목록은 표준 출력에, 요약은 오류에 나온다).
    pub fn run_op(&self, args: &[&str], input: Option<&[u8]>, timeout: Duration) -> Result<String, String> {
        let e = self.exec(args, input, timeout)?;
        let out = decode(&e.stdout).0;
        let err = decode(&e.stderr).0;
        let text = format!("{}\n{}", out.trim(), err.trim()).trim().to_string();
        if e.status.success() {
            Ok(text)
        } else if text.is_empty() {
            Err(format!("git {} 실패 ({})", args.join(" "), e.status))
        } else {
            Err(text)
        }
    }

    /// git을 실행하고 표준 출력을 글자로 돌려준다 (UTF-8, 잘못된 바이트는 대체 문자).
    pub fn run(&self, args: &[&str], timeout: Duration) -> Result<String, String> {
        let out = self.run_raw(args, None, timeout, &[])?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// 표준 오류까지 합친 결과 (fetch처럼 진행 메시지를 stderr로 쓰는 명령용)
    pub fn run_verbose(&self, args: &[&str], timeout: Duration) -> Result<String, String> {
        let out = self.run_raw(args, None, timeout, &[])?;
        Ok(format!("{}\n{}", String::from_utf8_lossy(&out.stdout).trim(), out.stderr).trim().to_string())
    }

    /// git 버전 문자열 (`git version 2.50.1.windows.1`)
    pub fn version() -> Result<(String, String), String> {
        let exe = find_git()?;
        let mut cmd = Command::new(&exe);
        cmd.arg("--version").stdin(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        }
        let out = cmd.output().map_err(|e| e.to_string())?;
        Ok((display(&exe), String::from_utf8_lossy(&out.stdout).trim().to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_repo_from_subdir_and_worktree_file() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("proj");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("apps/api")).unwrap();
        let r = find_repo(&root.join("apps/api")).unwrap();
        assert_eq!(r.root, root);
        assert_eq!(r.common_dir, root.join(".git"));

        // linked worktree: .git 파일이 실제 git 디렉터리를 가리키고, commondir로 공용 디렉터리를 찾는다
        let wt = tmp.path().join("wt");
        let wt_git = root.join(".git/worktrees/wt");
        std::fs::create_dir_all(&wt_git).unwrap();
        std::fs::write(wt_git.join("commondir"), "../..\n").unwrap();
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", wt_git.display())).unwrap();
        let r = find_repo(&wt).unwrap();
        assert_eq!(r.root, wt);
        assert_eq!(r.git_dir, wt_git);
        assert_eq!(norm(&r.common_dir.canonicalize().unwrap()), norm(&root.join(".git").canonicalize().unwrap()));

        assert!(find_repo(tmp.path()).is_none());
    }

    #[test]
    fn decodes_utf8_then_cp949() {
        assert_eq!(decode("한글".as_bytes()), ("한글".to_string(), "utf-8"));
        // "한글"의 CP949 바이트
        assert_eq!(decode(&[0xC7, 0xD1, 0xB1, 0xDB]), ("한글".to_string(), "cp949"));
    }

    #[test]
    fn rejects_option_like_revs() {
        assert!(check_rev("--output=x").is_err());
        assert!(check_rev(" ").is_err());
        assert_eq!(check_rev("main..feature/x").unwrap(), "main..feature/x");
        assert!(check_path("").is_err());
    }
}
