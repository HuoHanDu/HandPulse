//! 采集层：Raw Input 线程 → crossbeam channel → Aggregator 线程 → Tauri Channel → 前端。
//!
//! 线程原则：
//! - Raw Input 线程只解析原始事件，不碰磁盘 / UI；
//! - Aggregator 单线程持有全部可变计数，桶关闭时交给 Writer；
//! - Channel 发送失败时清空订阅，采集线程继续跑；
//! - 暂停时丢弃事件并清空 pressed，恢复后不会出现“卡住的键”。

pub mod aggregator;
#[cfg(windows)]
pub mod gamepad;
#[cfg(windows)]
pub mod keyboard_hook;
pub mod keymap;
#[cfg(windows)]
pub mod mouse_hook;
#[cfg(windows)]
pub mod windows_raw;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use crossbeam_channel::{Sender, bounded};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::ipc::Channel;

use crate::storage::Db;
use crate::storage::payload::CurrentBucket;
use crate::storage::writer::{WriteMsg, spawn as spawn_writer};

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
    /// 本帧新增的无序组合计数。
    #[serde(default)]
    pub pairs: Vec<(u32, u32)>,
    /// 本帧新增的 (pair << 3 | gap_bin) 计数。
    #[serde(default)]
    pub pair_gap: Vec<(u64, u32)>,
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
    /// 绝对坐标鼠标（RDP / 绘图板 / MOUSE_VIRTUAL_DESKTOP）跳过的移动事件数
    pub absolute_skipped: u64,
    pub latency_p50_ms: u64,
    pub latency_p95_ms: u64,
    pub latency_p99_ms: u64,
    pub uptime_ms: u64,
    /// 最近一次采集事件（epoch ms）；0 表示本次启动/重置以来还没有事件。
    pub last_event_ms: u64,
    /// 前台窗口是否运行在提升后的权限（约等于“管理员”）。
    pub foreground_elevated: bool,
    /// HandPulse 自身是否提升。
    pub app_elevated: bool,
    /// 前台提升、自己未提升：Raw Input 很可能被 UIPI 挡住。
    pub uipi_suspected: bool,
    pub error: Option<String>,
    pub storage_error: Option<String>,
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

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionKey {
    pub key_id: u16,
    pub count: u64,
    pub hold_sum: u64,
    pub hold_max: u64,
    pub first_min: u32,
    pub last_min: u32,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub keys: Vec<SessionKey>,
    pub clicks: [u64; 5],
    pub wheel: [u64; 2],
    pub move_px: f64,
    pub peak_speed: f64,
    pub chords: u64,
    pub grid: Vec<(u8, u8, u32)>,
    pub move_grid: Vec<(u8, u8, u32)>,
}

#[derive(Clone, Default)]
pub struct Snapshot {
    pub stats: CaptureStats,
    pub summary: SessionSummary,
    pub session: SessionSnapshot,
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
    /// 绝对坐标/虚拟桌面鼠标的移动包：M2 只承诺主屏相对坐标，直接跳过并计数。
    AbsoluteMove {
        at: Instant,
    },
    /// XInput 手柄按键按下沿；标准 17 键索引。
    PadButton {
        index: u8,
        at: Instant,
    },
}

/// 采集线程与命令共享的控制面。
pub struct Shared {
    pub paused: AtomicBool,
    pub reset_request: AtomicBool,
    pub reset_ack: AtomicBool,
    pub dropped: AtomicU64,
    pub error: Mutex<Option<String>>,
    pub storage_error: Arc<Mutex<Option<String>>>,
    pub snapshot: Mutex<Snapshot>,
    pub channel: Mutex<Option<Channel<LiveFrame>>>,
    pub live_bucket: Mutex<Option<CurrentBucket>>,
    pub bucket_seconds: AtomicU32,
    pub shutdown_request: AtomicBool,
    pub shutdown_ack: AtomicBool,
    pub started: Instant,
}

impl Shared {
    fn new(bucket_seconds: u32) -> Arc<Self> {
        Arc::new(Self {
            paused: AtomicBool::new(false),
            reset_request: AtomicBool::new(false),
            reset_ack: AtomicBool::new(false),
            dropped: AtomicU64::new(0),
            error: Mutex::new(None),
            storage_error: Arc::new(Mutex::new(None)),
            snapshot: Mutex::new(Snapshot::default()),
            channel: Mutex::new(None),
            live_bucket: Mutex::new(None),
            bucket_seconds: AtomicU32::new(bucket_seconds),
            shutdown_request: AtomicBool::new(false),
            shutdown_ack: AtomicBool::new(false),
            started: Instant::now(),
        })
    }
}

/// `app.manage(CaptureHandle::new(...))` 后由 setup 启动采集线程。
pub struct CaptureHandle {
    pub shared: Arc<Shared>,
    pub db: Option<Arc<Db>>,
    pub init_error: Option<String>,
    writer_tx: Mutex<Option<Sender<WriteMsg>>>,
    writer_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl CaptureHandle {
    pub fn new(db: Option<Arc<Db>>, init_error: Option<String>) -> Self {
        let bucket_seconds = db
            .as_ref()
            .and_then(|d| d.get_settings().ok())
            .map(|s| s.bucket_seconds)
            .unwrap_or(60);
        let handle = Self {
            shared: Shared::new(bucket_seconds),
            db,
            init_error,
            writer_tx: Mutex::new(None),
            writer_handle: Mutex::new(None),
        };
        if let Some(err) = &handle.init_error {
            *handle.shared.storage_error.lock() = Some(err.clone());
        }
        handle
    }

    pub fn start(&self) {
        let shared = self.shared.clone();
        let keymap = Arc::new(keymap::load());
        let writer_tx = if let Some(db) = &self.db {
            let (tx, handle) = spawn_writer(db.path().to_path_buf(), shared.storage_error.clone());
            *self.writer_tx.lock() = Some(tx.clone());
            *self.writer_handle.lock() = Some(handle);
            Some(tx)
        } else {
            None
        };

        let (tx, rx) = crossbeam_channel::bounded::<RawEvent>(8192);
        let agg_shared = shared.clone();
        let agg_keymap = keymap.clone();
        let agg_writer = writer_tx.clone();
        if let Err(err) = std::thread::Builder::new()
            .name("hp-aggregator".into())
            .spawn(move || aggregator::run(agg_shared, agg_keymap, rx, agg_writer))
        {
            mark_error(&shared, format!("aggregator 线程启动失败：{err}"));
            return;
        }

        #[cfg(windows)]
        let gamepad_tx = tx.clone();
        #[cfg(windows)]
        let mouse_tx = tx.clone();
        #[cfg(windows)]
        let keyboard_tx = tx.clone();
        #[cfg(windows)]
        {
            let hook_shared = shared.clone();
            if let Err(err) = std::thread::Builder::new()
                .name("hp-mouse-hook".into())
                .spawn(move || mouse_hook::run(hook_shared, mouse_tx))
            {
                eprintln!("[handpulse] 鼠标钩子线程启动失败: {err}");
            }
            let keyboard_shared = shared.clone();
            let keyboard_keymap = keymap.clone();
            if let Err(err) = std::thread::Builder::new()
                .name("hp-keyboard-hook".into())
                .spawn(move || keyboard_hook::run(keyboard_shared, keyboard_tx, keyboard_keymap))
            {
                eprintln!("[handpulse] 键盘钩子线程启动失败: {err}");
            }
            let raw_shared = shared.clone();
            let raw_keymap = keymap.clone();
            if let Err(err) = std::thread::Builder::new()
                .name("hp-raw-input".into())
                .spawn(move || windows_raw::run(raw_shared, raw_keymap, tx))
            {
                mark_error(&shared, format!("Raw Input 线程启动失败：{err}"));
            }
            let gp_shared = shared.clone();
            if let Err(err) = std::thread::Builder::new()
                .name("hp-gamepad".into())
                .spawn(move || gamepad::run(gp_shared, gamepad_tx))
            {
                eprintln!("[handpulse] 手柄线程启动失败: {err}");
            }
        }

        #[cfg(not(windows))]
        {
            let _ = (tx, keymap);
            mark_error(&shared, "当前平台不支持采集（仅 Windows）".into());
        }
    }

    /// 退出前：让 aggregator 关闭当前桶，再让 writer drain 并退出。
    pub fn shutdown(&self) {
        self.shared.shutdown_request.store(true, Ordering::Relaxed);
        let deadline = Instant::now() + Duration::from_millis(800);
        while Instant::now() < deadline {
            if self.shared.shutdown_ack.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let tx = self.writer_tx.lock().take();
        if let Some(tx) = tx {
            let (ack_tx, ack_rx) = bounded(1);
            if tx.send(WriteMsg::Shutdown(ack_tx)).is_ok() {
                let _ = ack_rx.recv_timeout(Duration::from_secs(1));
            }
        }
        if let Some(handle) = self.writer_handle.lock().take() {
            let _ = handle.join();
        }
    }

    pub fn clear_storage(&self) -> Result<(), String> {
        let tx = self
            .writer_tx
            .lock()
            .clone()
            .ok_or_else(|| "数据库不可用".to_string())?;
        let (ack_tx, ack_rx) = bounded(1);
        tx.send(WriteMsg::Clear(ack_tx))
            .map_err(|e| format!("清空任务发送失败：{e}"))?;
        ack_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|e| format!("清空数据库超时：{e}"))?
    }

    pub fn request_purge(&self) {
        if let Some(tx) = self.writer_tx.lock().clone() {
            let _ = tx.try_send(WriteMsg::Purge);
        }
    }
}

/// 启动失败时同时写 error 与快照，保证 `get_capture_stats` 能立刻显示“采集不可用”。
fn mark_error(shared: &Shared, message: String) {
    *shared.error.lock() = Some(message.clone());
    let mut snapshot = shared.snapshot.lock();
    snapshot.stats.running = false;
    snapshot.stats.error = Some(message);
}

impl Default for CaptureHandle {
    fn default() -> Self {
        Self::new(None, Some("数据库未初始化".into()))
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
