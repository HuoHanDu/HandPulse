mod capture;
mod commands;
mod storage;

use std::sync::Arc;

use capture::CaptureHandle;
use storage::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let (db, init_error) = match app.path().app_data_dir() {
                Ok(dir) => match Db::open(dir.join("data.db")) {
                    Ok(db) => (Some(Arc::new(db)), None),
                    Err(err) => {
                        eprintln!("[handpulse] 初始化数据库失败: {err:#}");
                        (None, Some(format!("初始化数据库失败：{err}")))
                    }
                },
                Err(err) => (None, Some(format!("无法获取数据目录：{err}"))),
            };
            app.manage(CaptureHandle::new(db, init_error));
            app.state::<CaptureHandle>().start();
            if let Some(window) = app.get_webview_window("main") {
                match tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
                    Ok(icon) => {
                        if let Err(err) = window.set_icon(icon) {
                            eprintln!("[handpulse] 设置窗口图标失败: {err}");
                        }
                    }
                    Err(err) => eprintln!("[handpulse] 读取窗口图标失败: {err}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::subscribe_live,
            commands::capture::unsubscribe_live,
            commands::capture::set_paused,
            commands::capture::get_capture_stats,
            commands::capture::get_session_summary,
            commands::capture::reset_session,
            commands::history::get_summary,
            commands::history::get_key_stats,
            commands::history::get_mouse_stats,
            commands::history::get_buckets,
            commands::history::get_histogram,
            commands::history::get_heatmap,
            commands::history::get_grid,
            commands::history::get_move_grid,
            commands::history::get_detail,
            commands::history::get_data_version,
            commands::history::get_settings,
            commands::history::set_settings,
            commands::history::clear_all_data,
            commands::history::get_current_bucket,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            app_handle.state::<CaptureHandle>().shutdown();
        }
    });
}
