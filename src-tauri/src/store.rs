//! 설정 파일 (`%APPDATA%\NanoGit\settings.json`, 환경변수 `NANOGIT_HOME`으로 바꿀 수 있음)

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 추가한 저장소 (최근 연 순)
    pub repos: Vec<RepoEntry>,
    /// 열려 있는 탭 (저장소 경로)
    pub tabs: Vec<String>,
    pub active: Option<String>,
    /// system, dark, light
    pub theme: String,
    /// 주기적 fetch 간격(분). 0이면 끔
    pub fetch_minutes: u32,
    /// all, current
    pub history_scope: String,
    /// unified, split
    pub diff_mode: String,
    pub ignore_whitespace: bool,
    /// 편집기 실행 파일 (비면 기본 프로그램으로 연다)
    pub editor: String,
    /// auto, wt, powershell, git-bash
    pub terminal: String,
    pub sidebar_width: u32,
    /// Windows 알림 (새 활동)
    pub notify_enabled: bool,
    pub notify_commit: bool,
    pub notify_push: bool,
    /// 전환·병합·pull·브랜치 생성
    pub notify_branch: bool,
    /// reset·강제 push·amend·rebase
    pub notify_warn: bool,
    /// 앱을 보고 있을 때도 알림
    pub notify_when_focused: bool,
    /// 창을 닫으면 트레이로 숨기고 감시를 계속한다
    pub close_to_tray: bool,
    /// Windows 시작 시 트레이로 실행
    pub start_with_windows: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            repos: Vec::new(),
            tabs: Vec::new(),
            active: None,
            theme: "system".into(),
            fetch_minutes: 0,
            history_scope: "all".into(),
            diff_mode: "unified".into(),
            ignore_whitespace: false,
            editor: String::new(),
            terminal: "auto".into(),
            sidebar_width: 240,
            notify_enabled: true,
            notify_commit: true,
            notify_push: true,
            notify_branch: false,
            notify_warn: true,
            notify_when_focused: false,
            close_to_tray: true,
            start_with_windows: false,
        }
    }
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn default_dir() -> PathBuf {
        if let Some(home) = std::env::var_os("NANOGIT_HOME").filter(|h| !h.is_empty()) {
            return PathBuf::from(home);
        }
        dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("NanoGit")
    }

    /// 설정 폴더를 따로 쓰는 실행인지 (개발·시험용. 단일 인스턴스 검사를 건너뛴다)
    pub fn uses_custom_dir() -> bool {
        std::env::var_os("NANOGIT_HOME").is_some_and(|h| !h.is_empty())
    }

    pub fn open(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Store { dir }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn file(&self) -> PathBuf {
        self.dir.join("settings.json")
    }

    /// 없거나 깨진 파일이면 기본값 (깨진 파일은 .bak으로 남긴다)
    pub fn load(&self) -> Settings {
        let path = self.file();
        let Ok(text) = std::fs::read_to_string(&path) else { return Settings::default() };
        match serde_json::from_str(&text) {
            Ok(s) => s,
            Err(_) => {
                let _ = std::fs::copy(&path, path.with_extension("json.bak"));
                Settings::default()
            }
        }
    }

    pub fn save(&self, s: &Settings) -> Result<(), String> {
        let text = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
        let tmp = self.file().with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| format!("설정을 저장하지 못했습니다: {e}"))?;
        std::fs::rename(&tmp, self.file()).map_err(|e| format!("설정을 저장하지 못했습니다: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::open(tmp.path().join("cfg"));
        assert_eq!(store.load(), Settings::default());
        let mut s = Settings::default();
        s.repos.push(RepoEntry { path: "C:/p/app".into(), name: "app".into() });
        s.tabs.push("C:/p/app".into());
        s.fetch_minutes = 10;
        store.save(&s).unwrap();
        assert_eq!(store.load(), s);

        // 모르는 필드·빠진 필드는 기본값으로
        std::fs::write(store.dir().join("settings.json"), r#"{"theme":"dark","unknown":1}"#).unwrap();
        let s = store.load();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.terminal, "auto");
        // 알림 설정이 없던 파일도 기본값(켜짐)으로 읽는다
        assert!(s.notify_enabled && s.notify_warn && !s.notify_branch);
        assert!(s.close_to_tray && !s.start_with_windows);

        // 깨진 파일
        std::fs::write(store.dir().join("settings.json"), "{").unwrap();
        assert_eq!(store.load(), Settings::default());
        assert!(store.dir().join("settings.json.bak").is_file());
    }
}
