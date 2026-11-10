//! 窗口控制：无边框窗口的原生边缘缩放、托盘退出、打开数据目录。

use tauri::Manager;

use crate::capture::CaptureHandle;

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    // 先让 aggregator 关闭当前桶、writer drain，再退出；避免退出丢最后一批数据。
    app.state::<CaptureHandle>().shutdown();
    app.exit(0);
}

#[tauri::command]
pub fn open_data_dir(state: tauri::State<'_, CaptureHandle>) -> Result<(), String> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| "数据库不可用，无法定位数据目录".to_string())?;
    let dir = db
        .path()
        .parent()
        .ok_or_else(|| "数据库路径没有父目录".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败：{e}"))?;

    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败：{e}"))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开文件管理器失败：{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_elevated() -> bool {
    crate::capture::windows_raw::elevation_status().1
}

/// 用 UAC 重新启动自己。返回 Err 通常表示用户取消了 UAC。
#[tauri::command]
pub fn relaunch_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::HSTRING;

        let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径：{e}"))?;
        // 新进程启动前先放掉单实例互斥量，否则提权后的新进程会立即退出。
        crate::single_instance::release();
        let operation = HSTRING::from("runas");
        let file = HSTRING::from(exe.to_string_lossy().as_ref());
        let result = unsafe { ShellExecuteW(None, &operation, &file, None, None, SW_SHOWNORMAL) };
        // ShellExecuteW 返回值 <= 32 表示失败；UAC 取消通常是 5 (ERROR_ACCESS_DENIED)。
        if result.0 as isize <= 32 {
            // UAC 被取消时恢复旧实例的锁，应用继续运行。
            let _ = crate::single_instance::acquire();
            return Err(format!(
                "请求管理员权限失败（错误码 {}）",
                result.0 as isize
            ));
        }
        app.state::<CaptureHandle>().shutdown();
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("仅 Windows 支持以管理员身份重启".into())
    }
}

/// 托盘隐藏/显示。Tauri 的 window.hide() 在当前无边框窗口上不总是生效，
/// 这里直接调用 Win32 ShowWindow，保证隐藏后进程继续采集。
#[tauri::command]
pub fn stage_database_import(bytes: Vec<u8>, app: tauri::AppHandle) -> Result<(), String> {
    const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";
    if bytes.len() < 16 || &bytes[..16] != SQLITE_HEADER {
        return Err("选择的文件不是 SQLite 数据库".into());
    }
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("数据库文件超过 200 MB，拒绝导入".into());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    let staging = dir.join("data.db.import");
    std::fs::write(&staging, &bytes).map_err(|e| format!("写入待导入数据库失败：{e}"))?;

    // 校验表结构，避免把任意 SQLite 文件当 HandPulse 数据库替换进去。
    let valid = (|| -> Result<(), String> {
        let conn = rusqlite::Connection::open(&staging).map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('bucket','meta')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if count < 2 {
            return Err("这个数据库缺少 HandPulse 的 bucket/meta 表".into());
        }
        Ok(())
    })();
    if let Err(err) = valid {
        let _ = std::fs::remove_file(&staging);
        return Err(err);
    }
    Ok(())
}

/// 启动时应用待导入数据库；先备份当前库，失败则保留原库。
pub fn apply_staged_import(dir: &std::path::Path) {
    let staged = dir.join("data.db.import");
    if !staged.exists() {
        return;
    }
    let target = dir.join("data.db");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let valid = (|| -> Result<(), String> {
        let conn = rusqlite::Connection::open(&staged).map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('bucket','meta')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if count < 2 {
            return Err("缺少 bucket/meta 表".into());
        }
        Ok(())
    })();
    if let Err(err) = valid {
        eprintln!("[handpulse] 待导入数据库无效，已忽略: {err}");
        let _ = std::fs::remove_file(&staged);
        return;
    }

    if target.exists() {
        let backup = dir.join(format!("data.db.bak-{stamp}"));
        if let Err(err) = std::fs::copy(&target, &backup) {
            eprintln!("[handpulse] 导入前备份失败，取消导入: {err}");
            return;
        }
        let previous = dir.join(format!("data.db.pre-import-{stamp}"));
        let _ = std::fs::remove_file(dir.join("data.db-wal"));
        let _ = std::fs::remove_file(dir.join("data.db-shm"));
        if let Err(err) = std::fs::rename(&target, &previous) {
            eprintln!("[handpulse] 暂存旧数据库失败，取消导入: {err}");
            return;
        }
    }
    match std::fs::rename(&staged, &target) {
        Ok(()) => eprintln!("[handpulse] 数据库导入完成，旧库已备份"),
        Err(err) => {
            eprintln!("[handpulse] 数据库导入失败: {err}");
            let backup = dir.join(format!("data.db.bak-{stamp}"));
            if backup.exists() && !target.exists() {
                let _ = std::fs::copy(&backup, &target);
            }
        }
    }
}

#[tauri::command]
pub fn set_main_hidden(hidden: bool, window: tauri::Window) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GA_ROOT, GetAncestor, SW_HIDE, SW_SHOW, SetForegroundWindow, ShowWindow,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        // WebView 的 hwnd 可能是子窗口；取根窗口才能隐藏整个应用。
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let target = if root.0.is_null() { hwnd } else { root };
        unsafe {
            let _ = ShowWindow(target, if hidden { SW_HIDE } else { SW_SHOW });
            if !hidden {
                let _ = SetForegroundWindow(target);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (hidden, window);
    }
    Ok(())
}

#[tauri::command]
pub fn start_resize(direction: String, window: tauri::Window) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows::Win32::UI::WindowsAndMessaging::{
            HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT,
            SendMessageW, WM_NCLBUTTONDOWN,
        };
        let hit = match direction.as_str() {
            "East" => HTRIGHT,
            "West" => HTLEFT,
            "North" => HTTOP,
            "South" => HTBOTTOM,
            "NorthEast" => HTTOPRIGHT,
            "NorthWest" => HTTOPLEFT,
            "SouthEast" => HTBOTTOMRIGHT,
            "SouthWest" => HTBOTTOMLEFT,
            _ => return Err(format!("未知缩放方向: {direction}")),
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        unsafe {
            let _ = ReleaseCapture();
            SendMessageW(
                hwnd,
                WM_NCLBUTTONDOWN,
                Some(WPARAM(hit as usize)),
                Some(LPARAM(0)),
            );
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (direction, window);
    }
    Ok(())
}
