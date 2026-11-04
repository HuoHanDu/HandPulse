//! 采集层：Raw Input 线程 → crossbeam channel → Aggregator 线程 → Tauri Channel → 前端。
//!
//! 线程原则：
//! - Raw Input 线程只解析原始事件，不碰磁盘 / UI；
//! - Aggregator 单线程持有全部可变计数，避免锁竞争；
//! - Channel 发送失败时清空订阅，采集线程继续跑；
//! - 暂停时丢弃事件并清空 pressed，恢复后不会出现“卡住的键”。

pub mod aggregator;
pub mod keymap;
#[cfg(windows)]
pub mod windows_raw;

use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::ipc::Channel;

/// 实时帧，字段与 `app/src/ipc/types.ts` 的 LiveFrame 一一对应。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFrame {
    pub seq: u64,
    pub ts: u64,
    pub keys: Vec<(u16, u32)>,
    pub clicks: [u32; 5],
    pub wheel: [i32; 2],
    pub dx: i32,
    pub dy: i32,
    pub grid: Vec<(u8, u8)>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopKey {
    pub label: String,
    pub count: u64,
}

/// 采集状态；`error` 非空表示采集不可用（应用仍可启动）。
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStats {
    pub running: bool,
    pub paused: bool,
    pub events: u64,
    pub key_events: u64,
    pub mouse_events: u64,
    pub dropped: u64,
    pub unmapped: u64,
    pub latency_p50_ms: u64,
    pub latency_p95_ms: u64,
    pub latency_p99_ms: u64,
    pub uptime_ms: u64,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub keys: u64,
    pub clicks: u64,
    pub wheel: [u64; 2],
    pub move_px: f64,
    pub chords: u64,
    pub top_keys: Vec<TopKey>,
    pub hold_avg_a_ms: u64,
    pub hold_max_a_ms: u64,
}

#[derive(Clone, Default)]
pub struct Snapshot {
    pub stats: CaptureStats,
    pub summary: SessionSummary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseBtn {
    Left,
    Right,
    Middle,
    Side1,
    Side2,
}

/// Raw Input 线程 → Aggregator 线程的事件。体积小、只带 Instant，不带任何字符串。
#[derive(Clone, Copy, Debug)]
pub enum RawEvent {
    Key {
        key_id: Option<u16>,
        down: bool,
        at: Instant,
        unmapped: Option<u16>,
    },
    Button {
        btn: MouseBtn,
        down: bool,
        at: Instant,
    },
    Wheel {
        delta: i16,
        at: Instant,
    },
    Move {
        dx: i32,
        dy: i32,
        at: Instant,
    },
}

/// 采集线程与命令共享的控制面。
pub struct Shared {
    pub paused: AtomicBool,
    pub reset_request: AtomicBool,
    pub dropped: AtomicU64,
    pub error: Mutex<Option<String>>,
    pub snapshot: Mutex<Snapshot>,
    pub channel: Mutex<Option<Channel<LiveFrame>>>,
    pub started: Instant,
}

impl Shared {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            paused: AtomicBool::new(false),
            reset_request: AtomicBool::new(false),
            dropped: AtomicU64::new(0),
            error: Mutex::new(None),
            snapshot: Mutex::new(Snapshot::default()),
            channel: Mutex::new(None),
            started: Instant::now(),
        })
    }
}

/// `app.manage(CaptureHandle::new())` 后由 setup 启动采集线程。
pub struct CaptureHandle {
    pub shared: Arc<Shared>,
}

impl CaptureHandle {
    pub fn new() -> Self {
        Self { shared: Shared::new() }
    }

    pub fn start(&self) {
        let shared = self.shared.clone();
        let keymap = Arc::new(keymap::load());

        let (tx, rx) = crossbeam_channel::bounded::<RawEvent>(8192);
        let agg_shared = shared.clone();
        let agg_keymap = keymap.clone();
        if let Err(err) = std::thread::Builder::new()
            .name("hp-aggregator".into())
            .spawn(move || aggregator::run(agg_shared, agg_keymap, rx))
        {
            *shared.error.lock() = Some(format!("aggregator 线程启动失败：{err}"));
            return;
        }

        #[cfg(windows)]
        {
            let raw_shared = shared.clone();
            let raw_keymap = keymap.clone();
            if let Err(err) = std::thread::Builder::new()
                .name("hp-raw-input".into())
                .spawn(move || windows_raw::run(raw_shared, raw_keymap, tx))
            {
                *shared.error.lock() = Some(format!("Raw Input 线程启动失败：{err}"));
            }
        }

        #[cfg(not(windows))]
        {
            let _ = (tx, keymap);
            *shared.error.lock() = Some("当前平台不支持采集（仅 Windows）".into());
        }
    }
}

impl Default for CaptureHandle {
    fn default() -> Self {
        Self::new()
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
