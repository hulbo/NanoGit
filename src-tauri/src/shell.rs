//! 외부 프로그램 열기: 터미널, 편집기

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::git::find_git;

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn in_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(exe)).find(|p| p.is_file())
}

/// Git for Windows의 git-bash.exe (`…\Git\cmd\git.exe` → `…\Git\git-bash.exe`)
fn git_bash() -> Option<PathBuf> {
    let git = find_git().ok()?;
    let base = git.parent()?.parent()?;
    let p = base.join("git-bash.exe");
    p.is_file().then_some(p)
}

/// 저장소 폴더에서 터미널을 연다. kind: auto, wt, powershell, git-bash
pub fn open_terminal(root: &Path, kind: &str) -> Result<(), String> {
    let kind = match kind {
        "auto" | "" => {
            if in_path("wt.exe").is_some() {
                "wt"
            } else {
                "powershell"
            }
        }
        k => k,
    };
    let result = match kind {
        "wt" => Command::new("wt.exe").arg("-d").arg(root).spawn(),
        "git-bash" => {
            let exe = git_bash().ok_or("Git Bash를 찾지 못했습니다")?;
            Command::new(exe).arg(format!("--cd={}", root.display())).spawn()
        }
        _ => {
            // 새 콘솔 창으로 띄운다
            let mut c = Command::new("cmd");
            c.args(["/C", "start", "", "powershell", "-NoExit"]).current_dir(root);
            no_window(&mut c);
            c.spawn()
        }
    };
    result.map(|_| ()).map_err(|e| format!("터미널을 열지 못했습니다: {e}"))
}

/// 편집기로 파일(또는 폴더)을 연다. 편집기를 정하지 않았으면 VS Code(`code`)를 찾아 보고, 없으면 기본 프로그램
pub fn open_editor(path: &Path, editor: &str) -> Result<(), String> {
    let editor = editor.trim();
    if !editor.is_empty() {
        return Command::new(editor).arg(path).spawn().map(|_| ()).map_err(|e| format!("편집기를 실행하지 못했습니다 ({editor}): {e}"));
    }
    if let Some(code) = in_path("code.cmd").or_else(|| in_path("code")) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(code).arg(path);
        no_window(&mut c);
        return c.spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}
