//! 历史数据查询 / 设置 / 清空命令。
//!
//! 所有 SQLite 读都走 `spawn_blocking`；命令线程只做参数校验与快照克隆。

use std::sync::Arc;

use tauri::State;

use crate::capture::{CaptureHandle, SessionKey};
use crate::storage::payload::CurrentBucket;
use crate::storage::query::{
    self, AppStat, BucketPoint, DetailPage, GridCell, Heatmap, Histogram, KeyStat, LiveSnapshot,
    MouseStats, PadStats, PatternStats, Range, Summary,
};
use crate::storage::{Db, Settings};

fn get_db(state: &State<'_, CaptureHandle>) -> Result<Arc<Db>, String> {
    state
        .db
        .clone()
        .ok_or_else(|| "数据库不可用，请重启应用或检查数据目录权限".to_string())
}

fn live_snapshot(shared: &crate::capture::Shared) -> LiveSnapshot {
    let snap = shared.snapshot.lock();
    let session = &snap.session;
    let keys = session
        .keys
        .iter()
        .map(|k: &SessionKey| query::LiveKey {
            key_id: k.key_id,
            count: k.count,
            hold_sum: k.hold_sum,
            hold_max: k.hold_max,
            first_min: k.first_min,
            last_min: k.last_min,
        })
        .collect();
    LiveSnapshot {
        keys,
        clicks: session.clicks,
        wheel: session.wheel,
        move_px: session.move_px,
        peak_speed: session.peak_speed,
        grid: session.grid.clone(),
        move_grid: session.move_grid.clone(),
        current: shared.live_bucket.lock().clone(),
    }
}

fn parse_range(range: &str) -> Result<Range, String> {
    Range::parse(range).map_err(|e| e.to_string())
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("查询线程失败：{e}"))?
}

#[tauri::command]
pub async fn get_summary(
    range: String,
    state: State<'_, CaptureHandle>,
) -> Result<Summary, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::summary(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_key_stats(
    range: String,
    layout: Option<u32>,
    state: State<'_, CaptureHandle>,
) -> Result<Vec<KeyStat>, String> {
    let _ = layout;
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::key_stats(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_app_stats(
    range: String,
    state: State<'_, CaptureHandle>,
) -> Result<Vec<AppStat>, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::app_stats(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_patterns(
    range: String,
    state: State<'_, CaptureHandle>,
) -> Result<PatternStats, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::patterns(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_mouse_stats(
    range: String,
    state: State<'_, CaptureHandle>,
) -> Result<MouseStats, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::mouse_stats(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_buckets(
    range: String,
    state: State<'_, CaptureHandle>,
) -> Result<Vec<BucketPoint>, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::buckets(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_histogram(
    range: String,
    dim: String,
    state: State<'_, CaptureHandle>,
) -> Result<Histogram, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::histogram(&db, r, &dim, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_heatmap(
    range: String,
    r#type: String,
    state: State<'_, CaptureHandle>,
) -> Result<Heatmap, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::heatmap(&db, r, &r#type, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_grid(
    range: String,
    state: State<'_, CaptureHandle>,
) -> Result<Vec<GridCell>, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::grid(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_move_grid(
    range: String,
    state: State<'_, CaptureHandle>,
) -> Result<Vec<GridCell>, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::move_grid(&db, r, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_detail(
    range: String,
    page: u32,
    state: State<'_, CaptureHandle>,
) -> Result<DetailPage, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        let r = parse_range(&range)?;
        query::detail(&db, r, page, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_data_version(state: State<'_, CaptureHandle>) -> Result<u64, String> {
    let db = get_db(&state)?;
    blocking(move || db.data_version().map_err(|e| e.to_string())).await
}

#[tauri::command]
pub fn get_settings(state: State<'_, CaptureHandle>) -> Result<Settings, String> {
    let db = state.db.clone().ok_or_else(|| "数据库不可用".to_string())?;
    db.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_settings(
    bucket_seconds: u32,
    retention_days: u32,
    state: State<'_, CaptureHandle>,
) -> Result<Settings, String> {
    let db = state.db.clone().ok_or_else(|| "数据库不可用".to_string())?;
    let old = db.get_settings().ok();
    let settings = db
        .set_settings(bucket_seconds, retention_days)
        .map_err(|e| e.to_string())?;
    state
        .shared
        .bucket_seconds
        .store(bucket_seconds, std::sync::atomic::Ordering::Relaxed);
    if old.map(|s| s.retention_days) != Some(retention_days) {
        state.request_purge();
    }
    Ok(settings)
}

#[tauri::command]
pub fn clear_all_data(state: State<'_, CaptureHandle>) -> Result<(), String> {
    // 前端已要求输入 DELETE；这里再确认一次数据库可用
    let _ = get_db(&state)?;
    // 先让 aggregator 关闭当前桶并重置，避免清空后又被当前桶写回
    state
        .shared
        .reset_ack
        .store(false, std::sync::atomic::Ordering::Relaxed);
    state
        .shared
        .reset_request
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1000);
    while std::time::Instant::now() < deadline {
        if state
            .shared
            .reset_ack
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    state.clear_storage()
}

#[tauri::command]
pub async fn get_custom_detail(
    start_ts: i64,
    end_ts: i64,
    page: u32,
    state: State<'_, CaptureHandle>,
) -> Result<DetailPage, String> {
    let db = get_db(&state)?;
    let live = live_snapshot(&state.shared);
    blocking(move || {
        query::custom_detail(&db, start_ts, end_ts, page, &live).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_custom_key_stats(
    start_ts: i64,
    end_ts: i64,
    state: State<'_, CaptureHandle>,
) -> Result<Vec<KeyStat>, String> {
    let db = get_db(&state)?;
    blocking(move || query::custom_key_stats(&db, start_ts, end_ts).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn get_custom_mouse_stats(
    start_ts: i64,
    end_ts: i64,
    state: State<'_, CaptureHandle>,
) -> Result<MouseStats, String> {
    let db = get_db(&state)?;
    blocking(move || query::custom_mouse_stats(&db, start_ts, end_ts).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn get_custom_pad_stats(
    start_ts: i64,
    end_ts: i64,
    state: State<'_, CaptureHandle>,
) -> Result<PadStats, String> {
    let db = get_db(&state)?;
    blocking(move || query::custom_pad_stats(&db, start_ts, end_ts).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub fn get_current_bucket(
    state: State<'_, CaptureHandle>,
) -> Result<Option<CurrentBucket>, String> {
    Ok(state.shared.live_bucket.lock().clone())
}
