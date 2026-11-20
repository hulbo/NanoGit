//! 트레이 상주: 트레이 아이콘·메뉴, 창 닫기 → 트레이로 숨기기, Windows 시작 시 실행.
//!
//! 메뉴에 보일 저장소 요약은 화면이 계산해 `tray_update`로 넘겨 준다 (변경 수·push 대기·새 활동).
//! 메뉴에서 고른 동작은 `tray://action` 이벤트로 화면에 돌려준다.

use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};
use tauri_plugin_notification::NotificationExt;

use crate::commands::AppCore;

pub const TRAY_ID: &str = "main";
pub const EVENT_TRAY: &str = "tray://action";
/// 확인하지 않은 새 활동이 있을 때의 아이콘 (빨간 점)
const ALERT_ICON: &[u8] = include_bytes!("../icons/tray-alert.png");

#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySummary {
    pub tooltip: String,
    pub repos: Vec<TrayRepo>,
    /// 알림 받기 (체크 표시)
    pub notify: bool,
    /// 확인하지 않은 새 활동이 있음
    pub alert: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayRepo {
    pub root: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TrayAction {
    OpenRepo { root: String },
    ToggleNotify,
    FetchAll,
}

fn current() -> &'static Mutex<Option<TraySummary>> {
    static CUR: OnceLock<Mutex<Option<TraySummary>>> = OnceLock::new();
    CUR.get_or_init(|| Mutex::new(None))
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, s: &TraySummary) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "show", "NanoGit 열기", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if s.repos.is_empty() {
        menu.append(&MenuItem::with_id(app, "none", "열린 저장소 없음", false, None::<&str>)?)?;
    }
    for (i, r) in s.repos.iter().enumerate() {
        menu.append(&MenuItem::with_id(app, format!("repo:{i}"), &r.label, true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&CheckMenuItem::with_id(app, "notify", "알림 받기", true, s.notify, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "fetch_all", "모든 저장소 fetch", !s.repos.is_empty(), None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "종료 (감시도 멈춤)", true, None::<&str>)?)?;
    Ok(menu)
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let first = TraySummary { tooltip: "NanoGit".into(), notify: true, ..Default::default() };
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("NanoGit")
        .menu(&build_menu(app, &first)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 화면이 보낸 요약으로 툴팁·메뉴·아이콘을 고친다 (바뀐 게 없으면 그대로)
pub fn update<R: Runtime>(app: &AppHandle<R>, s: TraySummary) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return Ok(()) };
    let mut cur = current().lock().map_err(|e| e.to_string())?;
    if cur.as_ref() == Some(&s) {
        return Ok(());
    }
    let alert_changed = cur.as_ref().map(|c| c.alert) != Some(s.alert);
    // Windows 트레이 툴팁은 127자까지
    let tip: String = s.tooltip.chars().take(120).collect();
    tray.set_tooltip(Some(tip)).map_err(|e| e.to_string())?;
    tray.set_menu(Some(build_menu(app, &s).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())?;
    if alert_changed {
        let icon = if s.alert { Image::from_bytes(ALERT_ICON).ok() } else { app.default_window_icon().cloned() };
        if let Some(icon) = icon {
            tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
        }
    }
    *cur = Some(s);
    Ok(())
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "show" => show_main(app),
        "quit" => app.exit(0),
        "notify" => {
            let _ = app.emit(EVENT_TRAY, TrayAction::ToggleNotify);
        }
        "fetch_all" => {
            let _ = app.emit(EVENT_TRAY, TrayAction::FetchAll);
        }
        _ => {
            let Some(i) = id.strip_prefix("repo:").and_then(|n| n.parse::<usize>().ok()) else { return };
            let root = current().lock().ok().and_then(|c| c.as_ref().and_then(|s| s.repos.get(i).map(|r| r.root.clone())));
            if let Some(root) = root {
                show_main(app);
                let _ = app.emit(EVENT_TRAY, TrayAction::OpenRepo { root });
            }
        }
    }
}

/// 창 닫기: 설정에 따라 트레이로 숨기고 감시를 계속한다
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    let Some(core) = window.app_handle().try_state::<Arc<AppCore>>() else { return };
    let to_tray = core.settings.lock().map(|s| s.close_to_tray).unwrap_or(true);
    if !to_tray {
        return;
    }
    api.prevent_close();
    let _ = window.hide();
    static TOLD: OnceLock<()> = OnceLock::new();
    if TOLD.set(()).is_ok() {
        let _ = window
            .app_handle()
            .notification()
            .builder()
            .title("NanoGit이 트레이에서 감시를 계속합니다")
            .body("트레이 아이콘을 눌러 다시 열고, 끝내려면 트레이 메뉴의 '종료'를 고르세요.")
            .show();
    }
}

// ── Windows 시작 시 실행 (HKCU\...\Run) ──

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "NanoGit";

/// 자동 실행 명령: 트레이로 시작한다
fn autostart_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\" --tray", exe.display()))
}

pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let value = if enabled { Some(autostart_command()?) } else { None };
    set_reg_value(RUN_KEY, RUN_NAME, value.as_deref())
}

fn reg(args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut cmd = std::process::Command::new("reg");
    cmd.args(args).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    cmd.output()
}

/// 레지스트리 문자열 값을 쓰거나(Some) 지운다(None). 이미 없는 값을 지우는 것은 성공으로 본다
fn set_reg_value(key: &str, name: &str, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(v) => {
            let out = reg(&["add", key, "/v", name, "/t", "REG_SZ", "/d", v, "/f"]).map_err(|e| e.to_string())?;
            if out.status.success() { Ok(()) } else { Err(format!("자동 실행을 등록하지 못했습니다: {}", String::from_utf8_lossy(&out.stderr).trim())) }
        }
        None => {
            if reg_value(key, name).is_none() {
                return Ok(());
            }
            let out = reg(&["delete", key, "/v", name, "/f"]).map_err(|e| e.to_string())?;
            if out.status.success() { Ok(()) } else { Err(format!("자동 실행을 해제하지 못했습니다: {}", String::from_utf8_lossy(&out.stderr).trim())) }
        }
    }
}

/// 레지스트리 문자열 값 (없으면 None)
fn reg_value(key: &str, name: &str) -> Option<String> {
    let out = reg(&["query", key, "/v", name]).ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    text.lines().find_map(|l| l.split_once("REG_SZ").map(|(_, v)| v.trim().to_string()))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// 실제 Run 키 대신 시험용 키에 쓰고 지운다 (시작 프로그램에는 영향 없음)
    #[test]
    fn registry_value_round_trip() {
        let key = format!(r"HKCU\Software\NanoGitTest{}", std::process::id());
        let cmd = r#""C:\Program Files\NanoGit\nanogit.exe" --tray"#;
        set_reg_value(&key, RUN_NAME, Some(cmd)).unwrap();
        assert_eq!(reg_value(&key, RUN_NAME).as_deref(), Some(cmd));
        set_reg_value(&key, RUN_NAME, None).unwrap();
        assert_eq!(reg_value(&key, RUN_NAME), None);
        // 없는 값 지우기도 성공
        set_reg_value(&key, RUN_NAME, None).unwrap();
        let _ = reg(&["delete", &key, "/f"]);
    }
}
