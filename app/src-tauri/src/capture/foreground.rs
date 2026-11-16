//! 前台窗口 exe 识别：只取进程 basename，不读窗口标题。
//!
//! 默认关闭；由设置页显式开启。结果缓存 1 秒，避免对每个输入事件都做
//! OpenProcess / QueryFullProcessImageName。

#![cfg(windows)]

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetCursorPos, GetForegroundWindow, GetWindowThreadProcessId,
};
use windows::core::PWSTR;

const GRID_W: i32 = 32;
const GRID_H: i32 = 18;

static ENABLED: AtomicBool = AtomicBool::new(false);
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

struct Cache {
    checked_at: Instant,
    app: Option<String>,
}

fn cache() -> &'static Mutex<Cache> {
    CACHE.get_or_init(|| {
        Mutex::new(Cache {
            checked_at: Instant::now() - Duration::from_secs(2),
            app: None,
        })
    })
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// 系统壳/锁屏/已知敏感程序不参与统计。
fn is_ignored(name: &str) -> bool {
    matches!(
        name,
        "lockapp.exe"
            | "logonui.exe"
            | "consent.exe"
            | "winlogon.exe"
            | "csrss.exe"
            | "dwm.exe"
            | "searchhost.exe"
            | "shellexperiencehost.exe"
            | "startmenuexperiencehost.exe"
            | "keepass.exe"
            | "keepassxc.exe"
            | "1password.exe"
            | "bitwarden.exe"
            | "lastpass.exe"
    )
}

/// 当前前台 exe basename；缓存 1 秒。权限不足/锁屏/敏感程序返回 None。
pub fn current_app() -> Option<String> {
    if !enabled() {
        return None;
    }
    let mut c = cache().lock().ok()?;
    if c.checked_at.elapsed() < Duration::from_secs(1) {
        return c.app.clone();
    }
    c.checked_at = Instant::now();
    c.app = query_foreground();
    c.app.clone()
}

fn query_foreground() -> Option<String> {
    let hwnd: HWND = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    result.ok()?;
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    let name = Path::new(&path)
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())?;
    if name.is_empty() || is_ignored(&name) {
        return None;
    }
    Some(name)
}

/// 当前光标在前台窗口客户区中的归一化网格（32×18，客户端坐标，不含标题栏/边框）。
/// 光标不在窗口内、窗口最小化或无法读取时返回 None。
pub fn cursor_grid_in_client() -> Option<(u16, u16)> {
    let hwnd: HWND = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    let mut rect = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut rect) }.is_err() {
        return None;
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return None;
    }
    let mut pt = POINT::default();
    if unsafe { GetCursorPos(&mut pt) }.is_err() {
        return None;
    }
    if !unsafe { ScreenToClient(hwnd, &mut pt) }.as_bool() {
        return None;
    }
    let x = pt.x - rect.left;
    let y = pt.y - rect.top;
    if x < 0 || y < 0 || x >= width || y >= height {
        return None;
    }
    let gx = ((x as f64 / width as f64) * GRID_W as f64).floor() as i32;
    let gy = ((y as f64 / height as f64) * GRID_H as f64).floor() as i32;
    Some((
        gx.clamp(0, GRID_W - 1) as u16,
        gy.clamp(0, GRID_H - 1) as u16,
    ))
}
