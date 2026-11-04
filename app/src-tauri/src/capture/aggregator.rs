//! Aggregator：单线程状态机，持有全部可变计数。
//!
//! 每 100ms 把增量封成 `LiveFrame`（没有事件也发空帧心跳），同时更新：
//! - CaptureStats（事件数、丢弃、未映射、p50/p95/p99 延迟、运行时长）；
//! - SessionSummary（按键/点击/滚轮/位移/组合键/Top 键/A 键按住）；
//! - 最近 60 个秒样本与内存 60s 桶（M3 接 SQLite 时直接落盘）。

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, RecvTimeoutError};

use super::keymap::Keymap;
use super::{
    now_ms, CaptureStats, LiveFrame, MouseBtn, RawEvent, SessionSummary, Shared, Snapshot, TopKey,
};

pub const KEY_COUNT: usize = 104;
pub const GRID_W: usize = 32;
pub const GRID_H: usize = 18;
const FLUSH_MS: u64 = 100;
/// 有事件积压时提前发帧，保证事件→帧发送 p99 < 30ms（G1）；空闲时仍按 100ms 心跳。
const ACTIVE_FLUSH_MS: u64 = 20;
const LATENCY_CAP: usize = 1024;
const SECOND_CAP: usize = 60;
const BUCKET_CAP: usize = 10;
const BUCKET_SECS: u64 = 60;
const MAX_EVENT_ATS: usize = 512;

#[derive(Clone, Default)]
pub struct SecondSample {
    pub ts: u64,
    pub keys: u32,
    pub clicks: u32,
    pub wheel: u32,
    pub move_px: f64,
}

#[derive(Clone, Default)]
pub struct Bucket {
    pub start_ms: u64,
    pub keys: u64,
    pub clicks: u64,
    pub wheel: u64,
    pub move_px: f64,
}

#[derive(Default)]
struct FrameAcc {
    keys: HashMap<u16, u32>,
    clicks: [u32; 5],
    wheel: [i32; 2],
    dx: i32,
    dy: i32,
    grid: Vec<(u8, u8)>,
    move_px: f64,
    event_ats: Vec<Instant>,
}

impl FrameAcc {
    fn reset(&mut self) {
        self.keys.clear();
        self.clicks = [0; 5];
        self.wheel = [0; 2];
        self.dx = 0;
        self.dy = 0;
        self.grid.clear();
        self.move_px = 0.0;
        self.event_ats.clear();
    }
}

pub struct Aggregator {
    keymap: Arc<Keymap>,
    pressed: HashMap<u16, Instant>,
    pub counts: [u64; KEY_COUNT],
    pub hold_sum: [u64; KEY_COUNT],
    pub hold_max: [u64; KEY_COUNT],
    pub hold_n: [u64; KEY_COUNT],
    pub clicks: [u64; 5],
    pub wheel: [u64; 2],
    pub wheel_accum: i32,
    pub move_px: f64,
    pub peak_speed: f64,
    pub grid: [u32; GRID_W * GRID_H],
    pub chords: u64,
    pub events: u64,
    pub key_events: u64,
    pub mouse_events: u64,
    pub unmapped: u64,
    pub latencies: VecDeque<u32>,
    pub seconds: VecDeque<SecondSample>,
    pub buckets: VecDeque<Bucket>,
    current_bucket: Bucket,
    second_acc: SecondSample,
    second_start: Instant,
    bucket_start: Instant,
    session_start: Instant,
    last_flush: Instant,
    frame: FrameAcc,
    seq: u64,
    paused: bool,
}

/// 光标归一化到 32×18 主屏网格；越界 clamp。抽成纯函数便于单测。
pub fn grid_coords(x: i32, y: i32, width: i32, height: i32) -> (u8, u8) {
    let w = width.max(1) as f64;
    let h = height.max(1) as f64;
    let gx = ((x as f64 / w) * GRID_W as f64).floor().clamp(0.0, (GRID_W - 1) as f64) as u8;
    let gy = ((y as f64 / h) * GRID_H as f64).floor().clamp(0.0, (GRID_H - 1) as f64) as u8;
    (gx, gy)
}

impl Aggregator {
    pub fn new(keymap: Arc<Keymap>) -> Self {
        let now = Instant::now();
        Self {
            keymap,
            pressed: HashMap::new(),
            counts: [0; KEY_COUNT],
            hold_sum: [0; KEY_COUNT],
            hold_max: [0; KEY_COUNT],
            hold_n: [0; KEY_COUNT],
            clicks: [0; 5],
            wheel: [0; 2],
            wheel_accum: 0,
            move_px: 0.0,
            peak_speed: 0.0,
            grid: [0; GRID_W * GRID_H],
            chords: 0,
            events: 0,
            key_events: 0,
            mouse_events: 0,
            unmapped: 0,
            latencies: VecDeque::with_capacity(LATENCY_CAP),
            seconds: VecDeque::with_capacity(SECOND_CAP),
            buckets: VecDeque::with_capacity(BUCKET_CAP),
            current_bucket: Bucket::default(),
            second_acc: SecondSample::default(),
            second_start: now,
            bucket_start: now,
            session_start: now,
            last_flush: now,
            frame: FrameAcc::default(),
            seq: 0,
            paused: false,
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        if paused && !self.paused {
            // 暂停瞬间清空按下集合，避免恢复后 hold 时长被暂停时间污染
            self.pressed.clear();
        }
        self.paused = paused;
    }

    /// 自上次 flush 以来是否有事件（决定发帧节奏：有事件 20ms，空闲 100ms）。
    pub fn has_pending_events(&self) -> bool {
        !self.frame.event_ats.is_empty()
    }

    pub fn reset_session(&mut self) {
        let now = Instant::now();
        self.pressed.clear();
        self.counts = [0; KEY_COUNT];
        self.hold_sum = [0; KEY_COUNT];
        self.hold_max = [0; KEY_COUNT];
        self.hold_n = [0; KEY_COUNT];
        self.clicks = [0; 5];
        self.wheel = [0; 2];
        self.wheel_accum = 0;
        self.move_px = 0.0;
        self.peak_speed = 0.0;
        self.grid = [0; GRID_W * GRID_H];
        self.chords = 0;
        self.frame.reset();
        self.seconds.clear();
        self.current_bucket = Bucket::default();
        self.bucket_start = now;
        self.second_start = now;
        self.session_start = now;
    }

    pub fn handle(&mut self, ev: RawEvent) {
        if self.paused {
            return;
        }
        if self.frame.event_ats.len() < MAX_EVENT_ATS {
            let at = match ev {
                RawEvent::Key { at, .. } => at,
                RawEvent::Button { at, .. } => at,
                RawEvent::Wheel { at, .. } => at,
                RawEvent::Move { at, .. } => at,
            };
            self.frame.event_ats.push(at);
        }
        self.events += 1;
        match ev {
            RawEvent::Key { key_id, down, at, unmapped } => {
                // keyEvents 只统计按下（一次按键 = 1，不把抬起重复算一次）
                if down {
                    self.key_events += 1;
                }
                let Some(id) = key_id else {
                    let _ = unmapped;
                    self.unmapped += 1;
                    return;
                };
                let id = id as usize;
                if id >= KEY_COUNT {
                    self.unmapped += 1;
                    return;
                }
                if down {
                    if self.pressed.contains_key(&(id as u16)) {
                        // 自动重复：不计数、不重置按住起点
                        return;
                    }
                    if !self.pressed.is_empty() {
                        self.chords += 1;
                    }
                    self.counts[id] += 1;
                    self.pressed.insert(id as u16, at);
                    *self.frame.keys.entry(id as u16).or_insert(0) += 1;
                } else if let Some(start) = self.pressed.remove(&(id as u16)) {
                    let hold = at.duration_since(start).as_millis() as u64;
                    self.hold_sum[id] += hold;
                    self.hold_n[id] += 1;
                    if hold > self.hold_max[id] {
                        self.hold_max[id] = hold;
                    }
                }
            }
            RawEvent::Button { btn, down, .. } => {
                self.mouse_events += 1;
                if !down {
                    return;
                }
                let idx = match btn {
                    MouseBtn::Left => 0,
                    MouseBtn::Right => 1,
                    MouseBtn::Middle => 2,
                    MouseBtn::Side1 => 3,
                    MouseBtn::Side2 => 4,
                };
                self.clicks[idx] += 1;
                self.frame.clicks[idx] += 1;
                if let Some((gx, gy)) = cursor_grid() {
                    let cell = gy as usize * GRID_W + gx as usize;
                    self.grid[cell] += 1;
                    self.frame.grid.push((gx, gy));
                }
            }
            RawEvent::Wheel { delta, .. } => {
                self.mouse_events += 1;
                self.wheel_accum += delta as i32;
                while self.wheel_accum >= 120 {
                    self.wheel_accum -= 120;
                    self.wheel[0] += 1;
                    self.frame.wheel[0] += 1;
                }
                while self.wheel_accum <= -120 {
                    self.wheel_accum += 120;
                    self.wheel[1] += 1;
                    self.frame.wheel[1] += 1;
                }
            }
            RawEvent::Move { dx, dy, .. } => {
                self.mouse_events += 1;
                self.frame.dx += dx;
                self.frame.dy += dy;
                let dist = ((dx as f64).powi(2) + (dy as f64).powi(2)).sqrt();
                self.move_px += dist;
                self.frame.move_px += dist;
            }
        }
    }

    /// 把当前增量封帧、更新快照并通过 Channel 发给前端；Channel 失败只清订阅。
    pub fn flush(&mut self, shared: &Shared) {
        let now = Instant::now();
        if shared.paused.load(Ordering::Relaxed) {
            // 暂停时停止计数与发帧，只刷新快照（恢复后 seq 从下一帧继续）
            self.frame.reset();
            self.last_flush = now;
            *shared.snapshot.lock() = self.snapshot(shared);
            return;
        }
        let elapsed = now.duration_since(self.last_flush).as_secs_f64().max(1e-6);
        let speed = self.frame.move_px / elapsed;
        if speed > self.peak_speed {
            self.peak_speed = speed;
        }

        for at in self.frame.event_ats.drain(..) {
            let ms = now.duration_since(at).as_millis().min(u32::MAX as u128) as u32;
            if self.latencies.len() >= LATENCY_CAP {
                self.latencies.pop_front();
            }
            self.latencies.push_back(ms);
        }

        self.seq += 1;
        let frame = LiveFrame {
            seq: self.seq,
            ts: now_ms(),
            keys: self.frame.keys.drain().collect(),
            clicks: self.frame.clicks,
            wheel: self.frame.wheel,
            dx: self.frame.dx,
            dy: self.frame.dy,
            grid: self.frame.grid.clone(),
        };

        // 秒样本（最近 60 个，M3 落盘用）
        self.second_acc.ts = now_ms();
        self.second_acc.keys += frame.keys.iter().map(|(_, d)| *d).sum::<u32>();
        self.second_acc.clicks += frame.clicks.iter().sum::<u32>();
        self.second_acc.wheel += (frame.wheel[0] + frame.wheel[1]).max(0) as u32;
        self.second_acc.move_px += self.frame.move_px;
        if now.duration_since(self.second_start) >= Duration::from_secs(1) {
            let sample = std::mem::take(&mut self.second_acc);
            if self.seconds.len() >= SECOND_CAP {
                self.seconds.pop_front();
            }
            self.seconds.push_back(sample);
            self.second_start = now;
        }

        // 60s 内存桶（M3 再接 SQLite）
        self.current_bucket.keys += frame.keys.iter().map(|(_, d)| *d as u64).sum::<u64>();
        self.current_bucket.clicks += frame.clicks.iter().map(|v| *v as u64).sum::<u64>();
        self.current_bucket.wheel += (frame.wheel[0] + frame.wheel[1]).max(0) as u64;
        self.current_bucket.move_px += self.frame.move_px;
        if now.duration_since(self.bucket_start) >= Duration::from_secs(BUCKET_SECS) {
            self.current_bucket.start_ms = now_ms().saturating_sub(BUCKET_SECS * 1000);
            let bucket = std::mem::take(&mut self.current_bucket);
            if self.buckets.len() >= BUCKET_CAP {
                self.buckets.pop_front();
            }
            self.buckets.push_back(bucket);
            self.bucket_start = now;
        }

        let snapshot = self.snapshot(shared);
        *shared.snapshot.lock() = snapshot;

        if let Some(ch) = shared.channel.lock().as_ref() {
            if ch.send(frame).is_err() {
                *shared.channel.lock() = None;
            }
        }

        self.frame.reset();
        self.last_flush = now;
    }

    pub fn snapshot(&self, shared: &Shared) -> Snapshot {
        let lat = self.latency_percentiles();
        let stats = CaptureStats {
            running: true,
            paused: shared.paused.load(Ordering::Relaxed),
            events: self.events,
            key_events: self.key_events,
            mouse_events: self.mouse_events,
            dropped: shared.dropped.load(Ordering::Relaxed),
            unmapped: self.unmapped,
            latency_p50_ms: lat.0,
            latency_p95_ms: lat.1,
            latency_p99_ms: lat.2,
            uptime_ms: shared.started.elapsed().as_millis() as u64,
            error: shared.error.lock().clone(),
        };

        let mut top: Vec<TopKey> = self
            .keymap
            .defs
            .iter()
            .filter_map(|d| {
                let c = self.counts.get(d.id as usize).copied().unwrap_or(0);
                (c > 0).then(|| TopKey { label: d.label.clone(), count: c })
            })
            .collect();
        top.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
        top.truncate(10);

        let a_id = self
            .keymap
            .defs
            .iter()
            .find(|d| d.label == "A")
            .map(|d| d.id as usize);
        let (hold_avg_a, hold_max_a) = match a_id {
            Some(id) if self.hold_n[id] > 0 => (self.hold_sum[id] / self.hold_n[id], self.hold_max[id]),
            _ => (0, 0),
        };

        let summary = SessionSummary {
            keys: self.counts.iter().sum(),
            clicks: self.clicks.iter().sum(),
            wheel: self.wheel,
            move_px: self.move_px,
            chords: self.chords,
            top_keys: top,
            hold_avg_a_ms: hold_avg_a,
            hold_max_a_ms: hold_max_a,
        };
        Snapshot { stats, summary }
    }

    fn latency_percentiles(&self) -> (u64, u64, u64) {
        if self.latencies.is_empty() {
            return (0, 0, 0);
        }
        let mut v: Vec<u32> = self.latencies.iter().copied().collect();
        v.sort_unstable();
        let pick = |p: f64| -> u64 {
            let idx = ((v.len() as f64 - 1.0) * p).round() as usize;
            v[idx.min(v.len() - 1)] as u64
        };
        (pick(0.50), pick(0.95), pick(0.99))
    }
}

pub fn run(shared: Arc<Shared>, keymap: Arc<Keymap>, rx: Receiver<RawEvent>) {
    let mut agg = Aggregator::new(keymap);
    loop {
        agg.set_paused(shared.paused.load(Ordering::Relaxed));
        if shared.reset_request.swap(false, Ordering::Relaxed) {
            agg.reset_session();
        }

        let elapsed = agg.last_flush.elapsed();
        let target = if agg.has_pending_events() { ACTIVE_FLUSH_MS } else { FLUSH_MS };
        if elapsed >= Duration::from_millis(target) {
            agg.flush(&shared);
            continue;
        }

        let wait = Duration::from_millis(target) - elapsed;
        match rx.recv_timeout(wait) {
            Ok(ev) => {
                agg.handle(ev);
                while let Ok(ev) = rx.try_recv() {
                    agg.handle(ev);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        let target = if agg.has_pending_events() { ACTIVE_FLUSH_MS } else { FLUSH_MS };
        if agg.last_flush.elapsed() >= Duration::from_millis(target) {
            agg.flush(&shared);
        }
    }
}

#[cfg(windows)]
fn cursor_grid() -> Option<(u8, u8)> {
    super::windows_raw::cursor_grid()
}

#[cfg(not(windows))]
fn cursor_grid() -> Option<(u8, u8)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::keymap;

    fn new_agg() -> (Aggregator, Arc<Keymap>) {
        let km = Arc::new(keymap::load());
        (Aggregator::new(km.clone()), km)
    }

    fn key_id(km: &Keymap, scan: u16, extended: bool) -> u16 {
        km.id_for(scan, extended).expect("mapped key")
    }

    #[test]
    fn thousand_key_pairs_count_exactly() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x11, false); // W
        let t0 = Instant::now();
        for i in 0..1000 {
            let at = t0 + Duration::from_millis(i * 2);
            agg.handle(RawEvent::Key { key_id: Some(id), down: true, at, unmapped: None });
            agg.handle(RawEvent::Key { key_id: Some(id), down: false, at: at + Duration::from_millis(50), unmapped: None });
        }
        assert_eq!(agg.counts[id as usize], 1000);
        assert_eq!(agg.hold_n[id as usize], 1000);
        assert_eq!(agg.hold_sum[id as usize], 1000 * 50);
        assert_eq!(agg.events, 2000);
        assert_eq!(agg.key_events, 1000);
        assert_eq!(agg.chords, 0);
    }

    #[test]
    fn auto_repeat_counts_once() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        for i in 0..30 {
            agg.handle(RawEvent::Key { key_id: Some(id), down: true, at: t0 + Duration::from_millis(i * 33), unmapped: None });
        }
        assert_eq!(agg.counts[id as usize], 1);
        assert_eq!(agg.chords, 0);
    }

    #[test]
    fn long_press_hold_ms() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x1e, false); // A
        let t0 = Instant::now();
        agg.handle(RawEvent::Key { key_id: Some(id), down: true, at: t0, unmapped: None });
        agg.handle(RawEvent::Key { key_id: Some(id), down: false, at: t0 + Duration::from_secs(5), unmapped: None });
        assert_eq!(agg.counts[id as usize], 1);
        assert!((4990..=5010).contains(&agg.hold_max[id as usize]), "hold = {}", agg.hold_max[id as usize]);
    }

    #[test]
    fn chord_increments() {
        let (mut agg, km) = new_agg();
        let w = key_id(&km, 0x11, false);
        let a = key_id(&km, 0x1e, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key { key_id: Some(w), down: true, at: t0, unmapped: None });
        agg.handle(RawEvent::Key { key_id: Some(a), down: true, at: t0, unmapped: None });
        assert_eq!(agg.chords, 1);
    }

    #[test]
    fn wheel_120_30_accumulator() {
        let (mut agg, _) = new_agg();
        let t0 = Instant::now();
        agg.handle(RawEvent::Wheel { delta: 120, at: t0 });
        agg.handle(RawEvent::Wheel { delta: 30, at: t0 });
        agg.handle(RawEvent::Wheel { delta: -120, at: t0 });
        // 120 + 30 - 120 = 30：已上滚 1 格，余 30 → 再 -120 后余 -90
        assert_eq!(agg.wheel, [1, 0]);
        assert_eq!(agg.wheel_accum, -90);
        agg.handle(RawEvent::Wheel { delta: -30, at: t0 });
        assert_eq!(agg.wheel, [1, 1]);
        assert_eq!(agg.wheel_accum, 0);
        agg.handle(RawEvent::Wheel { delta: 90, at: t0 });
        assert_eq!(agg.wheel, [1, 1]);
        assert_eq!(agg.wheel_accum, 90);
        agg.handle(RawEvent::Wheel { delta: 30, at: t0 });
        assert_eq!(agg.wheel, [2, 1]);
        assert_eq!(agg.wheel_accum, 0);
        agg.handle(RawEvent::Wheel { delta: -120, at: t0 });
        assert_eq!(agg.wheel, [2, 2]);
        assert_eq!(agg.wheel_accum, 0);
    }

    #[test]
    fn pause_discards_and_clears_pressed() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key { key_id: Some(id), down: true, at: t0, unmapped: None });
        assert_eq!(agg.pressed.len(), 1);
        agg.set_paused(true);
        agg.handle(RawEvent::Key { key_id: Some(id), down: true, at: t0, unmapped: None });
        agg.handle(RawEvent::Wheel { delta: 120, at: t0 });
        assert_eq!(agg.counts[id as usize], 1);
        assert_eq!(agg.wheel, [0, 0]);
        assert!(agg.pressed.is_empty());
        agg.set_paused(false);
        assert!(agg.pressed.is_empty());
    }

    #[test]
    fn reset_session_clears_counts_but_keeps_running() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key { key_id: Some(id), down: true, at: t0, unmapped: None });
        agg.handle(RawEvent::Button { btn: MouseBtn::Left, down: true, at: t0 });
        agg.handle(RawEvent::Wheel { delta: 120, at: t0 });
        agg.reset_session();
        assert_eq!(agg.counts[id as usize], 0);
        assert_eq!(agg.clicks, [0; 5]);
        assert_eq!(agg.wheel, [0, 0]);
        assert!(agg.pressed.is_empty());
        assert_eq!(agg.counts.iter().sum::<u64>(), 0);
        // 重置后仍可继续计数
        agg.handle(RawEvent::Key { key_id: Some(id), down: true, at: t0, unmapped: None });
        assert_eq!(agg.counts[id as usize], 1);
    }

    #[test]
    fn grid_clamps_out_of_bounds() {
        assert_eq!(grid_coords(0, 0, 1920, 1080), (0, 0));
        assert_eq!(grid_coords(1920, 1080, 1920, 1080), (31, 17));
        assert_eq!(grid_coords(-100, -100, 1920, 1080), (0, 0));
        assert_eq!(grid_coords(5000, 5000, 1920, 1080), (31, 17));
        assert_eq!(grid_coords(960, 540, 1920, 1080), (16, 9));
    }

    #[test]
    fn unmapped_does_not_panic() {
        let (mut agg, _) = new_agg();
        let t0 = Instant::now();
        agg.handle(RawEvent::Key { key_id: None, down: true, at: t0, unmapped: Some(0x99) });
        agg.handle(RawEvent::Key { key_id: Some(9999), down: true, at: t0, unmapped: None });
        assert_eq!(agg.unmapped, 2);
        assert_eq!(agg.counts.iter().sum::<u64>(), 0);
    }

    #[test]
    fn flush_emits_heartbeat_and_latency() {
        let (mut agg, km) = new_agg();
        let shared = Shared::new();
        let t0 = Instant::now();
        let id = key_id(&km, 0x11, false);
        agg.handle(RawEvent::Key { key_id: Some(id), down: true, at: t0, unmapped: None });
        std::thread::sleep(Duration::from_millis(5));
        agg.flush(&shared);
        let snap = shared.snapshot.lock().clone();
        assert_eq!(snap.stats.events, 1);
        assert_eq!(snap.stats.key_events, 1);
        assert_eq!(snap.stats.latency_p99_ms, 5.max(0));
        assert!(snap.stats.running);
        assert_eq!(snap.summary.keys, 1);
        // 空帧心跳：seq 继续增长
        let seq_before = agg.seq;
        agg.flush(&shared);
        assert_eq!(agg.seq, seq_before + 1);
        assert!(shared.snapshot.lock().stats.events >= 1);
        let _ = agg.session_start;
    }
}
