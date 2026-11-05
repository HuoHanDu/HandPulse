//! 单实例：避免双击启动两个采集器导致重复计数。

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

    // HANDLE 故意不 CloseHandle：它要活到进程结束，作为单实例标记。
    let _ = handle;
    true
}

#[cfg(not(windows))]
pub fn acquire() -> bool {
    true
}
