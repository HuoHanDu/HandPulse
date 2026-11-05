//! 采集相关 IPC 命令。

use std::sync::atomic::Ordering;

use tauri::State;
use tauri::ipc::Channel;

use crate::capture::{CaptureHandle, CaptureStats, LiveFrame, SessionSummary};

#[tauri::command]
pub fn subscribe_live(
    channel: Channel<LiveFrame>,
    state: State<'_, CaptureHandle>,
) -> Result<(), String> {
    *state.shared.channel.lock() = Some(channel);
    Ok(())
}

#[tauri::command]
pub fn unsubscribe_live(state: State<'_, CaptureHandle>) -> Result<(), String> {
    *state.shared.channel.lock() = None;
    Ok(())
}

#[tauri::command]
pub fn set_paused(paused: bool, state: State<'_, CaptureHandle>) -> Result<(), String> {
    state.shared.paused.store(paused, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn get_capture_stats(state: State<'_, CaptureHandle>) -> CaptureStats {
    let mut stats = state.shared.snapshot.lock().stats.clone();
    // 暂停状态是原子量，命令返回时以最新值为准（快照最多落后 100ms）
    stats.paused = state.shared.paused.load(Ordering::Relaxed);
    // 采集线程启动失败 / Raw Input 失败时，快照可能还没刷新；以 error 为准
    if let Some(err) = state.shared.error.lock().clone() {
        stats.running = false;
        stats.error = Some(err);
    }
    #[cfg(windows)]
    {
        let (foreground_elevated, app_elevated) = crate::capture::windows_raw::elevation_status();
        stats.foreground_elevated = foreground_elevated;
        stats.app_elevated = app_elevated;
        stats.uipi_suspected = foreground_elevated && !app_elevated;
    }
    stats
}

#[tauri::command]
pub fn get_session_summary(state: State<'_, CaptureHandle>) -> SessionSummary {
    state.shared.snapshot.lock().summary.clone()
}

#[tauri::command]
pub fn reset_session(state: State<'_, CaptureHandle>) -> Result<(), String> {
    state.shared.reset_request.store(true, Ordering::Relaxed);
    Ok(())
}
