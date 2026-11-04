mod capture;
mod commands;

use capture::CaptureHandle;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CaptureHandle::new())
        .setup(|app| {
            app.state::<CaptureHandle>().start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::subscribe_live,
            commands::capture::unsubscribe_live,
            commands::capture::set_paused,
            commands::capture::get_capture_stats,
            commands::capture::get_session_summary,
            commands::capture::reset_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
