//! 窗口控制：无边框窗口的原生边缘缩放。

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
