mod commands;
mod git;
mod shell;
mod store;
mod watch;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use commands::AppCore;
use store::Store;
use watch::WatchHub;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // 두 번째로 실행하면 이미 떠 있는 창을 앞으로 가져온다 (첫 번째로 등록해야 한다).
    // NANOGIT_HOME으로 설정 폴더를 따로 쓰는 실행(개발·시험)은 따로 띄운다.
    if !Store::uses_custom_dir() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let store = Store::open(Store::default_dir());
            let settings = store.load();
            let handle = app.handle().clone();
            let hub = WatchHub::new(Arc::new(move |change| {
                let _ = handle.emit(commands::EVENT_CHANGED, change);
            }));
            app.manage(Arc::new(AppCore { store, settings: Mutex::new(settings), hub }));
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
            commands::watch_set,
            commands::open_path,
            commands::reveal_path,
            commands::open_terminal,
            commands::open_editor,
            commands::notify_send,
        ])
        .run(tauri::generate_context!())
        .expect("NanoGit을 시작할 수 없습니다");
}
