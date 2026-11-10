//! 单实例：避免双击启动两个采集器导致重复计数。

#[cfg(windows)]
use std::sync::{Mutex, OnceLock};

#[cfg(windows)]
static INSTANCE: OnceLock<Mutex<Option<usize>>> = OnceLock::new();

#[cfg(windows)]
fn instance() -> &'static Mutex<Option<usize>> {
    INSTANCE.get_or_init(|| Mutex::new(None))
}

/// 交出单实例锁，让提权重启的新进程可以正常启动。
#[cfg(windows)]
pub(crate) fn release() {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    if let Ok(mut slot) = instance().lock()
        && let Some(raw) = slot.take()
    {
        unsafe {
            let _ = CloseHandle(HANDLE(raw as *mut core::ffi::c_void));
        }
    }
}

#[cfg(windows)]
pub fn acquire() -> bool {
    use windows::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SW_RESTORE, SetForegroundWindow, ShowWindow,
    };
    use windows::core::w;

    // Local\ 只约束当前登录会话；HandPulse 是桌面应用，不需要跨会话。
    let handle = unsafe { CreateMutexW(None, true, w!("Local\\HandPulse-SingleInstance-v1")) };
    let Ok(handle) = handle else {
        // 创建失败时不要阻止启动，退化为多实例。
        return true;
    };

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        // 已有一个实例：尽量把它的窗口拉到前台，然后退出第二个进程。
        unsafe {
            if let Ok(hwnd) = FindWindowW(None, w!("手脉 HandPulse")) {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
        }
        return false;
    }

    // 句柄要活到进程结束（或 release 时主动关闭），作为单实例标记。
    if let Ok(mut slot) = instance().lock() {
        *slot = Some(handle.0 as usize);
    }
    true
}

#[cfg(not(windows))]
pub fn acquire() -> bool {
    true
}
