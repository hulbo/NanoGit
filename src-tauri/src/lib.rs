mod commands;
mod git;
mod shell;
mod store;
mod tray;
mod watch;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use commands::AppCore;
use store::Store;
use watch::WatchHub;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // 두 번째로 실행하면 이미 떠 있는(트레이에 숨은) 창을 앞으로 가져온다 (첫 번째로 등록해야 한다).
    // NANOGIT_HOME으로 설정 폴더를 따로 쓰는 실행(개발·시험)은 따로 띄운다.
    if !Store::uses_custom_dir() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(tray::on_window_event)
        .setup(|app| {
            let store = Store::open(Store::default_dir());
            let settings = store.load();
            let handle = app.handle().clone();
            let hub = WatchHub::new(Arc::new(move |change| {
                let _ = handle.emit(commands::EVENT_CHANGED, change);
            }));
            app.manage(Arc::new(AppCore { store, settings: Mutex::new(settings), hub, busy: Arc::default() }));
            tray::setup(app.handle())?;
            // Windows 시작 시 자동 실행(--tray)이면 창을 띄우지 않고 트레이에서 감시만 한다
            if !std::env::args().any(|a| a == "--tray") {
                tray::show_main(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::settings_get,
            commands::settings_save,
            commands::repo_resolve,
            commands::status_get,
            commands::refs_get,
            commands::log_get,
            commands::commit_get,
            commands::commit_branches,
            commands::diff_get,
            commands::outgoing_get,
            commands::activity_get,
            commands::file_history,
            commands::file_blame,
            commands::file_content,
            commands::line_history,
            commands::files_list,
            commands::fetch,
            commands::git_op,
            commands::watch_set,
            commands::open_path,
            commands::reveal_path,
            commands::open_terminal,
            commands::open_editor,
            commands::notify_send,
            commands::tray_update,
            commands::window_show,
        ])
        .run(tauri::generate_context!())
        .expect("NanoGit을 시작할 수 없습니다");
}
