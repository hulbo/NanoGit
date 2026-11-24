//! 앱 안 업데이트: GitHub 릴리스의 latest.json을 보고 새 버전을 받아 설치한다 (tauri-plugin-updater).
//! 설치 파일은 CI가 서명하고(`TAURI_SIGNING_PRIVATE_KEY`), 앱은 tauri.conf.json의 공개 키로 확인한다.
//! Windows에서는 설치 프로그램(NSIS, passive)을 띄우고 앱이 바로 끝나며, 설치가 끝나면 다시 켜진다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

use crate::commands::Core;

/// 받는 중 진행 (받은 바이트, 전체 바이트)
pub const EVENT_PROGRESS: &str = "update://progress";
/// 업데이트하기 전 버전을 적어 두는 파일. 다시 켜졌을 때 창을 띄우고 알려 준다
const MARKER: &str = "updated-from.txt";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    /// 릴리스 노트
    pub notes: Option<String>,
    pub date: Option<String>,
}

fn message(e: impl std::fmt::Display) -> String {
    format!("업데이트를 확인하지 못했습니다: {e}")
}

async fn find(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    app.updater().map_err(message)?.check().await.map_err(message)
}

/// 새 버전이 있으면 그 정보
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    Ok(find(&app).await?.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        date: u.date.map(|d| d.date().to_string()),
    }))
}

/// 새 버전을 받아 설치한다. Windows에서는 설치 프로그램을 띄우고 앱이 끝난다 (설치 뒤 다시 켜짐)
#[tauri::command]
pub async fn update_install(app: AppHandle, core: Core<'_>) -> Result<(), String> {
    if core.busy.lock().map_err(|e| e.to_string())?.iter().next().is_some() {
        return Err("저장소 조작이 진행 중입니다. 끝난 뒤 업데이트하세요".into());
    }
    let Some(update) = find(&app).await? else {
        return Err("이미 최신 버전입니다".into());
    };
    let mut got: u64 = 0;
    let progress = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                got += chunk as u64;
                let _ = progress.emit(EVENT_PROGRESS, (got, total));
            },
            || {},
        )
        .await
        .map_err(|e| format!("새 버전을 받지 못했습니다: {e}"))?;
    let _ = std::fs::write(marker(core.store.dir()), &update.current_version);
    update.install(bytes).map_err(|e| {
        let _ = std::fs::remove_file(marker(core.store.dir()));
        format!("새 버전을 설치하지 못했습니다: {e}")
    })?;
    // Windows가 아니면 install이 돌아오므로 직접 다시 켠다
    app.restart();
}

fn marker(dir: &Path) -> PathBuf {
    dir.join(MARKER)
}

/// 업데이트로 다시 켜졌는지 (켜기 전 버전). 한 번 읽으면 지운다
pub fn take_updated_from(dir: &Path) -> Option<String> {
    let path = marker(dir);
    let from = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    Some(from.trim().to_string()).filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_is_read_once() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(take_updated_from(tmp.path()), None);
        std::fs::write(marker(tmp.path()), "0.1.3\n").unwrap();
        assert_eq!(take_updated_from(tmp.path()).as_deref(), Some("0.1.3"));
        assert!(!marker(tmp.path()).exists());
        assert_eq!(take_updated_from(tmp.path()), None);
    }
}
