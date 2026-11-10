mod capture;
mod commands;
mod single_instance;
mod storage;

use std::sync::Arc;

use capture::CaptureHandle;
use storage::Db;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !single_instance::acquire() {
        return;
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let (db, init_error) = match app.path().app_data_dir() {
                Ok(dir) => {
                    commands::window::apply_staged_import(&dir);
                    match Db::open(dir.join("data.db")) {
                        Ok(db) => (Some(Arc::new(db)), None),
                        Err(err) => {
                            eprintln!("[handpulse] 初始化数据库失败: {err:#}");
                            (None, Some(format!("初始化数据库失败：{err}")))
                        }
                    }
                }
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
                #[cfg(windows)]
                if let Ok(hwnd) = window.hwnd() {
                    // decorations:false 会丢掉原生 resize 边框；补回 WS_THICKFRAME，
                    // 让鼠标边缘缩放和自定义 resize 热区都有命中的窗口样式。
                    use windows::Win32::UI::WindowsAndMessaging::{
                        GWL_STYLE, GetWindowLongPtrW, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE,
                        SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos, WS_THICKFRAME,
                    };
                    unsafe {
                        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                        let next = style | WS_THICKFRAME.0 as isize;
                        if next != style {
                            let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, next);
                            let _ = SetWindowPos(
                                hwnd,
                                None,
                                0,
                                0,
                                0,
                                0,
                                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
                            );
                        }
                    }
                }
            }
            if let Err(err) = build_tray(app) {
                eprintln!("[handpulse] 创建托盘失败: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::subscribe_live,
            commands::capture::unsubscribe_live,
            commands::capture::set_paused,
            commands::capture::get_capture_stats,
            commands::capture::get_hook_status,
            commands::capture::get_session_summary,
            commands::capture::get_gamepad_state,
            commands::capture::reset_gamepad_counts,
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
            commands::history::get_custom_detail,
            commands::history::get_custom_key_stats,
            commands::history::get_custom_mouse_stats,
            commands::history::get_custom_pad_stats,
            commands::history::get_data_version,
            commands::history::get_settings,
            commands::history::set_settings,
            commands::history::clear_all_data,
            commands::history::get_current_bucket,
            commands::window::start_resize,
            commands::window::quit_app,
            commands::window::open_data_dir,
            commands::window::set_main_hidden,
            commands::window::stage_database_import,
            commands::window::is_elevated,
            commands::window::relaunch_as_admin,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            app_handle.state::<CaptureHandle>().shutdown();
        }
    });
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(windows)]
        if let Ok(hwnd) = window.hwnd() {
            use windows::Win32::UI::WindowsAndMessaging::{
                GA_ROOT, GetAncestor, SW_SHOW, SetForegroundWindow, ShowWindow,
            };
            let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
            let target = if root.0.is_null() { hwnd } else { root };
            unsafe {
                let _ = ShowWindow(target, SW_SHOW);
                let _ = SetForegroundWindow(target);
            }
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 HandPulse", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/32x32.png"
        ))?)
        .menu(&menu)
        .tooltip("手脉 HandPulse · 本地键鼠使用分析")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => commands::window::quit_app(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
