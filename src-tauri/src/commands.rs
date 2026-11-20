//! 화면에서 부르는 IPC 명령. git 실행은 시간이 걸리므로 모두 별도 스레드에서 한다.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;

use crate::git::model::*;
use crate::git::{Git, display, find_repo};
use crate::store::{Settings, Store};
use crate::watch::WatchHub;

pub const EVENT_CHANGED: &str = "repo://changed";

pub struct AppCore {
    pub store: Store,
    pub settings: Mutex<Settings>,
    pub hub: Arc<WatchHub>,
}

type Core<'a> = State<'a, Arc<AppCore>>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn open(root: &str) -> Result<Git, String> {
    Git::open(Path::new(root))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    git_path: Option<String>,
    git_version: Option<String>,
    git_error: Option<String>,
    data_dir: String,
}

#[tauri::command]
pub async fn app_info(app: tauri::AppHandle, core: Core<'_>) -> Result<AppInfo, String> {
    let data_dir = display(core.store.dir());
    let version = app.package_info().version.to_string();
    blocking(move || {
        Ok(match Git::version() {
            Ok((path, ver)) => AppInfo { version, git_path: Some(path), git_version: Some(ver), git_error: None, data_dir },
            Err(e) => AppInfo { version, git_path: None, git_version: None, git_error: Some(e), data_dir },
        })
    })
    .await
}

#[tauri::command]
pub fn settings_get(core: Core<'_>) -> Result<Settings, String> {
    core.settings.lock().map(|s| s.clone()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_save(core: Core<'_>, settings: Settings) -> Result<(), String> {
    core.store.save(&settings)?;
    *core.settings.lock().map_err(|e| e.to_string())? = settings;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    root: String,
    name: String,
}

/// 고른 폴더에서 저장소 루트를 찾는다 (하위 폴더를 골라도 된다)
#[tauri::command]
pub async fn repo_resolve(path: String) -> Result<RepoRef, String> {
    blocking(move || {
        let loc = find_repo(&PathBuf::from(&path)).ok_or_else(|| format!("git 저장소가 아닙니다: {path}"))?;
        let name = loc.root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| display(&loc.root));
        Ok(RepoRef { root: display(&loc.root), name })
    })
    .await
}

#[tauri::command]
pub async fn status_get(root: String) -> Result<Status, String> {
    blocking(move || open(&root)?.status()).await
}

#[tauri::command]
pub async fn refs_get(root: String) -> Result<Refs, String> {
    blocking(move || open(&root)?.refs()).await
}

#[tauri::command]
pub async fn log_get(root: String, query: LogQuery) -> Result<Vec<Commit>, String> {
    blocking(move || open(&root)?.log(&query)).await
}

#[tauri::command]
pub async fn commit_get(root: String, sha: String) -> Result<CommitDetail, String> {
    blocking(move || open(&root)?.commit(&sha)).await
}

#[tauri::command]
pub async fn commit_branches(root: String, sha: String) -> Result<Vec<String>, String> {
    blocking(move || open(&root)?.branches_containing(&sha)).await
}

#[tauri::command]
pub async fn diff_get(root: String, target: DiffTarget, options: Option<DiffOptions>) -> Result<TextBlob, String> {
    blocking(move || open(&root)?.diff(&target, &options.unwrap_or_default())).await
}

#[tauri::command]
pub async fn outgoing_get(root: String, all: bool) -> Result<Vec<OutgoingBranch>, String> {
    blocking(move || open(&root)?.outgoing(all)).await
}

#[tauri::command]
pub async fn activity_get(root: String, limit: Option<u32>) -> Result<Vec<ActivityEntry>, String> {
    blocking(move || Ok(open(&root)?.activity(0, limit.unwrap_or(300) as usize))).await
}

#[tauri::command]
pub async fn file_history(root: String, path: String, follow: bool, skip: u32, limit: u32, rev: Option<String>) -> Result<Vec<HistoryEntry>, String> {
    blocking(move || open(&root)?.file_history(&path, follow, skip, limit, rev.as_deref())).await
}

#[tauri::command]
pub async fn file_blame(root: String, path: String, rev: Option<String>) -> Result<Blame, String> {
    blocking(move || open(&root)?.blame(&path, rev.as_deref())).await
}

#[tauri::command]
pub async fn file_content(root: String, path: String, rev: Option<String>) -> Result<TextBlob, String> {
    blocking(move || open(&root)?.file_content(&path, rev.as_deref())).await
}

#[tauri::command]
pub async fn line_history(root: String, path: String, start: u32, end: u32, rev: Option<String>) -> Result<Vec<LineHistoryEntry>, String> {
    blocking(move || open(&root)?.line_history(&path, start, end, rev.as_deref())).await
}

#[tauri::command]
pub async fn files_list(root: String, rev: Option<String>) -> Result<Vec<String>, String> {
    blocking(move || open(&root)?.files(rev.as_deref())).await
}

#[tauri::command]
pub async fn fetch(root: String) -> Result<String, String> {
    blocking(move || open(&root)?.fetch()).await
}

/// 감시할 저장소 목록 (열린 탭)
#[tauri::command]
pub async fn watch_set(core: Core<'_>, roots: Vec<String>) -> Result<Vec<String>, String> {
    let hub = core.hub.clone();
    blocking(move || Ok(hub.set(&roots))).await
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_terminal(core: Core<'_>, root: String) -> Result<(), String> {
    let kind = core.settings.lock().map(|s| s.terminal.clone()).unwrap_or_default();
    crate::shell::open_terminal(Path::new(&root), &kind)
}

/// Windows 알림 (알림 센터에도 남는다)
#[tauri::command]
pub fn notify_send(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(title).body(body).show().map_err(|e| format!("알림을 보내지 못했습니다: {e}"))
}

#[tauri::command]
pub fn open_editor(core: Core<'_>, path: String) -> Result<(), String> {
    let editor = core.settings.lock().map(|s| s.editor.clone()).unwrap_or_default();
    crate::shell::open_editor(Path::new(&path), &editor)
}
