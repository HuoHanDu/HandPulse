//! Aggregator：单线程状态机，持有全部可变计数。
//!
//! 每 100ms 把增量封成 `LiveFrame`（没有事件也发空帧心跳），同时维护：
//! - 会话累计（CaptureStats / SessionSummary / SessionSnapshot）；
//! - 当前未关闭桶（本地时区对齐），关闭时交给 Writer 落盘。

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use chrono::{Local, Timelike};
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender};

use super::keymap::Keymap;
use super::{
    CaptureStats, LiveFrame, MouseBtn, RawEvent, SessionKey, SessionSnapshot, SessionSummary,
    Shared, Snapshot, TopKey, now_ms,
};
use crate::storage::payload::{
    CurrentBucket, Device, KbPayload, MousePayload, PadPayload, PersistBucket, encode, px_to_cm,
};
use crate::storage::writer::WriteMsg;

pub const KEY_COUNT: usize = 104;
pub const GRID_W: usize = 32;
pub const GRID_H: usize = 18;
const FLUSH_MS: u64 = 100;
/// 有事件积压时提前发帧，保证事件→帧发送 p99 < 30ms（G1）；空闲时仍按 100ms 心跳。
const ACTIVE_FLUSH_MS: u64 = 20;
const LATENCY_CAP: usize = 1024;
const SECOND_CAP: usize = 60;
const MAX_EVENT_ATS: usize = 512;
const STREAK_GAP_MS: u64 = 5000;
const MOUSE_TOKEN_BASE: u16 = 104;
const PAIR_WINDOW_MS: u64 = 350;
const RECENT_CAP: usize = 8;

struct RecentInput {
    token: u16,
    at: Instant,
}

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
    pairs: HashMap<u32, u32>,
    pair_gap: HashMap<u64, u32>,
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
        self.pairs.clear();
        self.pair_gap.clear();
        self.move_px = 0.0;
        self.event_ats.clear();
    }
}

struct BucketAcc {
    ts: i64,
    granularity: u32,
    start: Instant,
    counts: HashMap<u16, u32>,
    hold_sum: HashMap<u16, u64>,
    hold_max: HashMap<u16, u64>,
    first: HashMap<u16, i64>,
    last: HashMap<u16, i64>,
    clicks: [u64; 5],
    wheel: [u64; 2],
    move_px: f64,
    grid: [u32; GRID_W * GRID_H],
    move_grid: [u32; GRID_W * GRID_H],
    gap: [u32; 5],
    chord: u64,
    peak_speed: f64,
    fast: u64,
    pad: [u32; 17],
    pair: HashMap<u32, u32>,
    pair_gap: HashMap<u64, u32>,
}

impl Default for BucketAcc {
    fn default() -> Self {
        Self {
            ts: 0,
            granularity: 60,
            start: Instant::now(),
            counts: HashMap::new(),
            hold_sum: HashMap::new(),
            hold_max: HashMap::new(),
            first: HashMap::new(),
            last: HashMap::new(),
            clicks: [0; 5],
            wheel: [0; 2],
            move_px: 0.0,
            grid: [0; GRID_W * GRID_H],
            move_grid: [0; GRID_W * GRID_H],
            gap: [0; 5],
            chord: 0,
            peak_speed: 0.0,
            fast: 0,
            pad: [0; 17],
            pair: HashMap::new(),
            pair_gap: HashMap::new(),
        }
    }
}

impl BucketAcc {
    fn new(granularity: u32, now: Instant) -> Self {
        Self {
            ts: align_ts(granularity),
            granularity,
            start: now,
            ..Self::default()
        }
    }
    fn reset(&mut self, granularity: u32, now: Instant) {
        *self = Self::new(granularity, now);
    }

    fn has_kb(&self) -> bool {
        !self.counts.is_empty() || !self.pair.is_empty()
    }

    fn has_mouse(&self) -> bool {
        self.clicks.iter().any(|v| *v > 0)
            || self.wheel.iter().any(|v| *v > 0)
            || self.move_px > 0.0
    }

    fn has_pad(&self) -> bool {
        self.pad.iter().any(|v| *v > 0)
    }

    fn pad_payload(&self, session: u64) -> PadPayload {
        PadPayload {
            v: 1,
            session,
            buttons: self
                .pad
                .iter()
                .enumerate()
                .filter(|(_, count)| **count > 0)
                .map(|(i, count)| (i as u8, *count))
                .collect(),
        }
    }

    fn kb_payload(&self, streak_ms: u64) -> KbPayload {
        KbPayload {
            v: 2,
            session: 0,
            k: self.counts.iter().map(|(k, v)| (*k, *v)).collect(),
            hold_sum: self.hold_sum.iter().map(|(k, v)| (*k, *v)).collect(),
            hold_max: self.hold_max.iter().map(|(k, v)| (*k, *v)).collect(),
            chord: self.chord,
            gap: self.gap,
            streak_ms,
            first: self.first.iter().map(|(k, v)| (*k, *v)).collect(),
            last: self.last.iter().map(|(k, v)| (*k, *v)).collect(),
            pair: self.pair.iter().map(|(k, v)| (*k, *v)).collect(),
            pair_gap: self.pair_gap.iter().map(|(k, v)| (*k, *v)).collect(),
        }
    }

    fn mouse_payload(&self) -> MousePayload {
        let mut grid = BTreeMap::new();
        let mut mgrid = BTreeMap::new();
        for (i, count) in self.grid.iter().enumerate() {
            if *count == 0 {
                continue;
            }
            let x = (i % GRID_W) as u8;
            let y = (i / GRID_W) as u8;
            grid.insert(format!("{x},{y}"), *count);
        }
        for (i, count) in self.move_grid.iter().enumerate() {
            if *count == 0 {
                continue;
            }
            let x = (i % GRID_W) as u8;
            let y = (i / GRID_W) as u8;
            mgrid.insert(format!("{x},{y}"), *count);
        }
        MousePayload {
            v: 1,
            session: 0,
            cl: self.clicks,
            wh: self.wheel,
            px: self.move_px,
            cm: px_to_cm(self.move_px),
            vmax: self.peak_speed,
            fast: self.fast,
            grid,
            mgrid,
        }
    }

    fn current(&self) -> CurrentBucket {
        CurrentBucket {
            ts: self.ts,
            granularity: self.granularity,
            kb: self.kb_payload(0),
            mouse: self.mouse_payload(),
        }
    }
}

pub struct Aggregator {
    keymap: Arc<Keymap>,
    writer: Option<Sender<WriteMsg>>,
    granularity: u32,
    pressed: HashMap<u16, Instant>,
    pub counts: [u64; KEY_COUNT],
    pub hold_sum: [u64; KEY_COUNT],
    pub hold_max: [u64; KEY_COUNT],
    pub hold_n: [u64; KEY_COUNT],
    first_min: [u32; KEY_COUNT],
    last_min: [u32; KEY_COUNT],
    pub clicks: [u64; 5],
    pub wheel: [u64; 2],
    pub wheel_accum: i32,
    pub move_px: f64,
    pub peak_speed: f64,
    pub grid: [u32; GRID_W * GRID_H],
    pub move_grid: [u32; GRID_W * GRID_H],
    pub chords: u64,
    pub events: u64,
    pub key_events: u64,
    pub mouse_events: u64,
    pub unmapped: u64,
    pub absolute_skipped: u64,
    pub latencies: VecDeque<u32>,
    pub last_event_ms: u64,
    pub seconds: VecDeque<SecondSample>,
    pub buckets: VecDeque<Bucket>,
    current_bucket: Bucket,
    second_acc: SecondSample,
    second_start: Instant,
    session_start: Instant,
    last_flush: Instant,
    frame: FrameAcc,
    bucket: BucketAcc,
    last_key_at: Option<Instant>,
    last_input_at: Option<Instant>,
    last_move_sample: Option<Instant>,
    speed_window_start: Instant,
    speed_window_px: f64,
    streak_start: Option<Instant>,
    longest_streak_ms: u64,
    seq: u64,
    session_id: u64,
    paused: bool,
    recent: VecDeque<RecentInput>,
}

/// 光标归一化到 32×18 主屏网格；越界 clamp。抽成纯函数便于单测。
pub fn grid_coords(x: i32, y: i32, width: i32, height: i32) -> (u8, u8) {
    let w = width.max(1) as f64;
    let h = height.max(1) as f64;
    let gx = ((x as f64 / w) * GRID_W as f64)
        .floor()
        .clamp(0.0, (GRID_W - 1) as f64) as u8;
    let gy = ((y as f64 / h) * GRID_H as f64)
        .floor()
        .clamp(0.0, (GRID_H - 1) as f64) as u8;
    (gx, gy)
}

fn align_ts(granularity: u32) -> i64 {
    let now = Local::now().timestamp();
    now - now.rem_euclid(granularity.max(1) as i64)
}

fn now_secs() -> i64 {
    Local::now().timestamp()
}

fn new_session_id() -> u64 {
    // 进程内唯一；重启后 id 不同，允许同一分钟的不完整桶合并。
    now_ms() ^ ((std::process::id() as u64) << 32)
}

fn minute_of_day_now() -> u32 {
    let now = Local::now();
    now.hour() * 60 + now.minute()
}

fn gap_bin(ms: u64) -> usize {
    match ms {
        0..=49 => 0,
        50..=99 => 1,
        100..=199 => 2,
        200..=499 => 3,
        _ => 4,
    }
}

fn pair_gap_bin(ms: u64) -> usize {
    match ms {
        0..=39 => 0,
        40..=79 => 1,
        80..=119 => 2,
        120..=199 => 3,
        200..=349 => 4,
        350..=499 => 5,
        _ => 6,
    }
}

impl Aggregator {
    pub fn new(keymap: Arc<Keymap>, writer: Option<Sender<WriteMsg>>, granularity: u32) -> Self {
        let now = Instant::now();
        Self {
            keymap,
            writer,
            granularity,
            pressed: HashMap::new(),
            counts: [0; KEY_COUNT],
            hold_sum: [0; KEY_COUNT],
            hold_max: [0; KEY_COUNT],
            hold_n: [0; KEY_COUNT],
            first_min: [0; KEY_COUNT],
            last_min: [0; KEY_COUNT],
            clicks: [0; 5],
            wheel: [0; 2],
            wheel_accum: 0,
            move_px: 0.0,
            peak_speed: 0.0,
            grid: [0; GRID_W * GRID_H],
            move_grid: [0; GRID_W * GRID_H],
            chords: 0,
            events: 0,
            key_events: 0,
            mouse_events: 0,
            unmapped: 0,
            absolute_skipped: 0,
            latencies: VecDeque::with_capacity(LATENCY_CAP),
            last_event_ms: 0,
            seconds: VecDeque::with_capacity(SECOND_CAP),
            buckets: VecDeque::new(),
            current_bucket: Bucket::default(),
            second_acc: SecondSample::default(),
            second_start: now,
            session_start: now,
            last_flush: now,
            frame: FrameAcc::default(),
            bucket: BucketAcc::new(granularity, now),
            last_key_at: None,
            last_input_at: None,
            last_move_sample: None,
            speed_window_start: now,
            speed_window_px: 0.0,
            streak_start: None,
            longest_streak_ms: 0,
            seq: 0,
            session_id: new_session_id(),
            paused: false,
            recent: VecDeque::with_capacity(RECENT_CAP),
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        if paused && !self.paused {
            self.pressed.clear();
            self.recent.clear();
        }
        self.paused = paused;
    }

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
        self.first_min = [0; KEY_COUNT];
        self.last_min = [0; KEY_COUNT];
        self.clicks = [0; 5];
        self.wheel = [0; 2];
        self.wheel_accum = 0;
        self.move_px = 0.0;
        self.peak_speed = 0.0;
        self.grid = [0; GRID_W * GRID_H];
        self.move_grid = [0; GRID_W * GRID_H];
        self.chords = 0;
        self.events = 0;
        self.key_events = 0;
        self.mouse_events = 0;
        self.unmapped = 0;
        self.absolute_skipped = 0;
        self.latencies.clear();
        self.last_event_ms = 0;
        self.frame.reset();
        self.seconds.clear();
        self.buckets.clear();
        self.current_bucket = Bucket::default();
        self.second_start = now;
        self.session_start = now;
        self.last_key_at = None;
        self.last_input_at = None;
        self.recent.clear();
        self.last_move_sample = None;
        self.speed_window_px = 0.0;
        self.speed_window_start = now;
        self.streak_start = None;
        self.longest_streak_ms = 0;
        self.bucket.reset(self.granularity, now);
    }

    fn record_pair(&mut self, token: u16, at: Instant) {
        for prev in self.recent.iter().rev().take(3) {
            if prev.token == token {
                continue;
            }
            let gap = at.saturating_duration_since(prev.at).as_millis() as u64;
            if gap > PAIR_WINDOW_MS {
                continue;
            }
            let (a, b) = if prev.token < token {
                (prev.token, token)
            } else {
                (token, prev.token)
            };
            let pair = ((a as u32) << 16) | b as u32;
            *self.bucket.pair.entry(pair).or_insert(0) += 1;
            *self.frame.pairs.entry(pair).or_insert(0) += 1;
            let key = ((pair as u64) << 3) | pair_gap_bin(gap) as u64;
            *self.bucket.pair_gap.entry(key).or_insert(0) += 1;
            *self.frame.pair_gap.entry(key).or_insert(0) += 1;
        }
        self.recent.push_back(RecentInput { token, at });
        if self.recent.len() > RECENT_CAP {
            self.recent.pop_front();
        }
    }

    fn touch_input(&mut self, at: Instant) {
        if let Some(prev) = self.last_input_at {
            let gap = at.saturating_duration_since(prev);
            if gap <= Duration::from_millis(STREAK_GAP_MS) {
                if let Some(start) = self.streak_start {
                    let streak = at.saturating_duration_since(start).as_millis() as u64;
                    self.longest_streak_ms = self.longest_streak_ms.max(streak);
                }
            } else {
                self.streak_start = Some(at);
            }
        } else {
            self.streak_start = Some(at);
        }
        self.last_input_at = Some(at);
    }

    pub fn handle(&mut self, ev: RawEvent) {
        if self.paused {
            return;
        }
        self.last_event_ms = now_ms();
        if self.frame.event_ats.len() < MAX_EVENT_ATS {
            let at = match ev {
                RawEvent::Key { at, .. } => at,
                RawEvent::Button { at, .. } => at,
                RawEvent::Wheel { at, .. } => at,
                RawEvent::Move { at, .. } => at,
                RawEvent::AbsoluteMove { at } => at,
                RawEvent::PadButton { at, .. } => at,
            };
            self.frame.event_ats.push(at);
        }
        self.events += 1;
        match ev {
            RawEvent::Key {
                key_id,
                down,
                at,
                unmapped,
            } => {
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
                        return;
                    }
                    self.key_events += 1;
                    let chorded = !self.pressed.is_empty();
                    if chorded {
                        self.chords += 1;
                    }
                    self.counts[id] += 1;
                    let minute = minute_of_day_now();
                    if self.first_min[id] == 0 {
                        self.first_min[id] = minute;
                    }
                    self.last_min[id] = minute;
                    self.pressed.insert(id as u16, at);
                    *self.frame.keys.entry(id as u16).or_insert(0) += 1;

                    let bucket = &mut self.bucket;
                    *bucket.counts.entry(id as u16).or_insert(0) += 1;
                    if chorded {
                        bucket.chord += 1;
                    }
                    let ts = now_secs();
                    bucket.first.entry(id as u16).or_insert(ts);
                    bucket.last.insert(id as u16, ts);
                    if let Some(prev) = self.last_key_at {
                        let gap = at.saturating_duration_since(prev).as_millis() as u64;
                        bucket.gap[gap_bin(gap)] += 1;
                    }
                    self.last_key_at = Some(at);
                    self.record_pair(id as u16, at);
                    self.touch_input(at);
                } else if let Some(start) = self.pressed.remove(&(id as u16)) {
                    let hold = at.duration_since(start).as_millis() as u64;
                    self.hold_sum[id] += hold;
                    self.hold_n[id] += 1;
                    if hold > self.hold_max[id] {
                        self.hold_max[id] = hold;
                    }
                    let bucket = &mut self.bucket;
                    *bucket.hold_sum.entry(id as u16).or_insert(0) += hold;
                    let e = bucket.hold_max.entry(id as u16).or_insert(0);
                    *e = (*e).max(hold);
                }
            }
            RawEvent::Button { btn, down, at } => {
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
                self.bucket.clicks[idx] += 1;
                if let Some((gx, gy)) = cursor_grid() {
                    let cell = gy as usize * GRID_W + gx as usize;
                    self.grid[cell] += 1;
                    self.bucket.grid[cell] += 1;
                    self.frame.grid.push((gx, gy));
                }
                self.record_pair(MOUSE_TOKEN_BASE + idx as u16, at);
                self.touch_input(at);
            }
            RawEvent::Wheel { delta, at } => {
                self.mouse_events += 1;
                self.wheel_accum += delta as i32;
                while self.wheel_accum >= 120 {
                    self.wheel_accum -= 120;
                    self.wheel[0] += 1;
                    self.bucket.wheel[0] += 1;
                    self.frame.wheel[0] += 1;
                }
                while self.wheel_accum <= -120 {
                    self.wheel_accum += 120;
                    self.wheel[1] += 1;
                    self.bucket.wheel[1] += 1;
                    self.frame.wheel[1] += 1;
                }
                self.touch_input(at);
            }
            RawEvent::Move { dx, dy, at } => {
                self.mouse_events += 1;
                self.frame.dx += dx;
                self.frame.dy += dy;
                let dist = ((dx as f64).powi(2) + (dy as f64).powi(2)).sqrt();
                self.move_px += dist;
                self.bucket.move_px += dist;
                self.frame.move_px += dist;
                // 移动热力采样：50ms 一次，避免高频鼠标事件里频繁 GetCursorPos
                if self.last_move_sample.is_none_or(|last| {
                    at.saturating_duration_since(last) >= Duration::from_millis(50)
                }) && let Some((gx, gy)) = cursor_grid()
                {
                    let cell = gy as usize * GRID_W + gx as usize;
                    self.move_grid[cell] += 1;
                    self.bucket.move_grid[cell] += 1;
                    self.last_move_sample = Some(at);
                }
            }
            RawEvent::AbsoluteMove { .. } => {
                self.mouse_events += 1;
                self.absolute_skipped += 1;
            }
            RawEvent::PadButton { index, at } => {
                if let Some(slot) = self.bucket.pad.get_mut(index as usize) {
                    *slot = slot.saturating_add(1);
                    self.touch_input(at);
                }
            }
        }
    }

    /// 关闭当前桶：两个设备分别封包；空桶不写。
    pub fn close_bucket(&mut self, shared: &Shared) {
        let streak = self.longest_streak_ms;
        if self.bucket.has_kb() {
            let mut p = self.bucket.kb_payload(streak);
            p.session = self.session_id;
            let actions = p.actions();
            if let Ok(blob) = encode(&p) {
                let ts = self.bucket.ts;
                let gran = self.bucket.granularity;
                if let Some(tx) = &self.writer {
                    let b = PersistBucket::new(ts, gran, Device::Kb, actions, blob);
                    if tx.try_send(WriteMsg::Bucket(Box::new(b))).is_err() {
                        shared.dropped.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
        if self.bucket.has_mouse() {
            let mut p = self.bucket.mouse_payload();
            p.session = self.session_id;
            let actions = p.actions();
            if let Ok(blob) = encode(&p) {
                let ts = self.bucket.ts;
                let gran = self.bucket.granularity;
                if let Some(tx) = &self.writer {
                    let b = PersistBucket::new(ts, gran, Device::Mouse, actions, blob);
                    if tx.try_send(WriteMsg::Bucket(Box::new(b))).is_err() {
                        shared.dropped.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
        if self.bucket.has_pad() {
            let p = self.bucket.pad_payload(self.session_id);
            let actions = p.actions();
            if let Ok(blob) = encode(&p) {
                let ts = self.bucket.ts;
                let gran = self.bucket.granularity;
                if let Some(tx) = &self.writer {
                    let b = PersistBucket::new(ts, gran, Device::Pad, actions, blob);
                    if tx.try_send(WriteMsg::Bucket(Box::new(b))).is_err() {
                        shared.dropped.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
        self.bucket.reset(self.granularity, Instant::now());
        self.recent.clear();
        *shared.live_bucket.lock() = Some(self.bucket.current());
    }

    /// 把当前增量封帧、更新快照并通过 Channel 发给前端；Channel 失败只清订阅。
    pub fn flush(&mut self, shared: &Shared) {
        let now = Instant::now();
        let paused = shared.paused.load(Ordering::Relaxed);
        if paused {
            if self.bucket.has_kb() || self.bucket.has_mouse() {
                self.close_bucket(shared);
            }
            self.frame.reset();
            self.last_flush = now;
            self.bucket.ts = align_ts(self.granularity);
            *shared.live_bucket.lock() = Some(self.bucket.current());
            *shared.snapshot.lock() = self.snapshot(shared);
            return;
        }

        // 峰值速度按 100ms 窗口计算，避免两次相邻 flush 间隔过小导致 px/s 虚高
        self.speed_window_px += self.frame.move_px;
        let win = now.duration_since(self.speed_window_start);
        if win >= Duration::from_millis(100) {
            let speed = self.speed_window_px / win.as_secs_f64();
            self.peak_speed = self.peak_speed.max(speed);
            self.bucket.peak_speed = self.bucket.peak_speed.max(speed);
            if speed >= 2000.0 {
                self.bucket.fast += 1;
            }
            self.speed_window_px = 0.0;
            self.speed_window_start = now;
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
            pairs: self.frame.pairs.drain().collect(),
            pair_gap: self.frame.pair_gap.drain().collect(),
        };

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

        self.current_bucket.keys += frame.keys.iter().map(|(_, d)| *d as u64).sum::<u64>();
        self.current_bucket.clicks += frame.clicks.iter().map(|v| *v as u64).sum::<u64>();
        self.current_bucket.wheel += (frame.wheel[0] + frame.wheel[1]).max(0) as u64;
        self.current_bucket.move_px += self.frame.move_px;
        if now.duration_since(self.bucket.start) >= Duration::from_secs(1) {
            if self.buckets.len() >= 10 {
                self.buckets.pop_front();
            }
            self.buckets.push_back(self.current_bucket.clone());
            self.current_bucket = Bucket::default();
        }

        // 桶边界
        let wanted = shared.bucket_seconds.load(Ordering::Relaxed);
        if wanted != self.granularity {
            self.close_bucket(shared);
            self.granularity = wanted;
            self.bucket.reset(wanted, now);
        } else if now_secs() >= self.bucket.ts + self.granularity as i64 {
            self.close_bucket(shared);
        }
        *shared.live_bucket.lock() = Some(self.bucket.current());

        *shared.snapshot.lock() = self.snapshot(shared);

        // 只锁一次并复用 guard；发送失败时在同一 guard 里清空订阅，避免 parking_lot 自锁
        let mut slot = shared.channel.lock();
        if slot.as_ref().is_some_and(|ch| ch.send(frame).is_err()) {
            *slot = None;
        }
        drop(slot);

        self.frame.reset();
        self.last_flush = now;
    }

    pub fn snapshot(&self, shared: &Shared) -> Snapshot {
        let lat = self.latency_percentiles();
        let error = shared.error.lock().clone();
        let stats = CaptureStats {
            running: error.is_none(),
            paused: shared.paused.load(Ordering::Relaxed),
            events: self.events,
            key_events: self.key_events,
            mouse_events: self.mouse_events,
            dropped: shared.dropped.load(Ordering::Relaxed),
            unmapped: self.unmapped,
            absolute_skipped: self.absolute_skipped,
            latency_p50_ms: lat.0,
            latency_p95_ms: lat.1,
            latency_p99_ms: lat.2,
            uptime_ms: shared.started.elapsed().as_millis() as u64,
            last_event_ms: self.last_event_ms,
            foreground_elevated: false,
            app_elevated: false,
            uipi_suspected: false,
            error,
            storage_error: shared.storage_error.lock().clone(),
        };

        let mut top: Vec<TopKey> = self
            .keymap
            .defs
            .iter()
            .filter_map(|d| {
                let c = self.counts.get(d.id as usize).copied().unwrap_or(0);
                (c > 0).then(|| TopKey {
                    label: d.label.clone(),
                    count: c,
                })
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
            Some(id) if self.hold_n[id] > 0 => {
                (self.hold_sum[id] / self.hold_n[id], self.hold_max[id])
            }
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

        let mut keys = Vec::new();
        for id in 0..KEY_COUNT {
            if self.counts[id] > 0 {
                keys.push(SessionKey {
                    key_id: id as u16,
                    count: self.counts[id],
                    hold_sum: self.hold_sum[id],
                    hold_max: self.hold_max[id],
                    first_min: self.first_min[id],
                    last_min: self.last_min[id],
                });
            }
        }
        let grid = self
            .grid
            .iter()
            .enumerate()
            .filter(|(_, v)| **v > 0)
            .map(|(i, v)| ((i % GRID_W) as u8, (i / GRID_W) as u8, *v))
            .collect();
        let move_grid = self
            .move_grid
            .iter()
            .enumerate()
            .filter(|(_, v)| **v > 0)
            .map(|(i, v)| ((i % GRID_W) as u8, (i / GRID_W) as u8, *v))
            .collect();
        let session = SessionSnapshot {
            keys,
            clicks: self.clicks,
            wheel: self.wheel,
            move_px: self.move_px,
            peak_speed: self.peak_speed,
            chords: self.chords,
            grid,
            move_grid,
        };

        Snapshot {
            stats,
            summary,
            session,
        }
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

pub fn run(
    shared: Arc<Shared>,
    keymap: Arc<Keymap>,
    rx: Receiver<RawEvent>,
    writer: Option<Sender<WriteMsg>>,
) {
    let granularity = shared.bucket_seconds.load(Ordering::Relaxed);
    let mut agg = Aggregator::new(keymap, writer, granularity);
    loop {
        if shared.shutdown_request.load(Ordering::Relaxed) {
            agg.close_bucket(&shared);
            *shared.snapshot.lock() = agg.snapshot(&shared);
            shared.shutdown_ack.store(true, Ordering::Relaxed);
            break;
        }
        agg.set_paused(shared.paused.load(Ordering::Relaxed));
        if shared.reset_request.swap(false, Ordering::Relaxed) {
            // 先把当前桶落盘，再重置会话，避免未满桶数据丢失
            agg.close_bucket(&shared);
            agg.reset_session();
            *shared.snapshot.lock() = agg.snapshot(&shared);
            shared.reset_ack.store(true, Ordering::Relaxed);
        }

        let elapsed = agg.last_flush.elapsed();
        let target = if agg.has_pending_events() {
            ACTIVE_FLUSH_MS
        } else {
            FLUSH_MS
        };
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
        let target = if agg.has_pending_events() {
            ACTIVE_FLUSH_MS
        } else {
            FLUSH_MS
        };
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
        (Aggregator::new(km.clone(), None, 60), km)
    }

    fn key_id(km: &Keymap, scan: u16, extended: bool) -> u16 {
        km.id_for(scan, extended).expect("mapped key")
    }

    #[test]
    fn thousand_key_pairs_count_exactly() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        for i in 0..1000 {
            let at = t0 + Duration::from_millis(i * 2);
            agg.handle(RawEvent::Key {
                key_id: Some(id),
                down: true,
                at,
                unmapped: None,
            });
            agg.handle(RawEvent::Key {
                key_id: Some(id),
                down: false,
                at: at + Duration::from_millis(50),
                unmapped: None,
            });
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
            agg.handle(RawEvent::Key {
                key_id: Some(id),
                down: true,
                at: t0 + Duration::from_millis(i * 33),
                unmapped: None,
            });
        }
        assert_eq!(agg.counts[id as usize], 1);
        assert_eq!(agg.key_events, 1);
        assert_eq!(agg.chords, 0);
    }

    #[test]
    fn ten_downs_one_up_counts_once() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        for i in 0..10 {
            agg.handle(RawEvent::Key {
                key_id: Some(id),
                down: true,
                at: t0 + Duration::from_millis(i * 30),
                unmapped: None,
            });
        }
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: false,
            at: t0 + Duration::from_millis(400),
            unmapped: None,
        });
        assert_eq!(agg.counts[id as usize], 1);
        assert_eq!(agg.key_events, 1);
        assert_eq!(agg.hold_n[id as usize], 1);
        assert_eq!(agg.events, 11);
    }

    #[test]
    fn long_press_hold_ms() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x1e, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: false,
            at: t0 + Duration::from_secs(5),
            unmapped: None,
        });
        assert_eq!(agg.counts[id as usize], 1);
        assert!((4990..=5010).contains(&agg.hold_max[id as usize]));
        assert_eq!(agg.bucket.gap, [0; 5]);
    }

    #[test]
    fn chord_increments() {
        let (mut agg, km) = new_agg();
        let w = key_id(&km, 0x11, false);
        let a = key_id(&km, 0x1e, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key {
            key_id: Some(w),
            down: true,
            at: t0,
            unmapped: None,
        });
        agg.handle(RawEvent::Key {
            key_id: Some(a),
            down: true,
            at: t0,
            unmapped: None,
        });
        assert_eq!(agg.chords, 1);
        assert_eq!(agg.bucket.chord, 1);
    }

    #[test]
    fn wheel_120_30_accumulator() {
        let (mut agg, _) = new_agg();
        let t0 = Instant::now();
        agg.handle(RawEvent::Wheel { delta: 120, at: t0 });
        agg.handle(RawEvent::Wheel { delta: 30, at: t0 });
        agg.handle(RawEvent::Wheel {
            delta: -120,
            at: t0,
        });
        assert_eq!(agg.wheel, [1, 0]);
        assert_eq!(agg.wheel_accum, -90);
        agg.handle(RawEvent::Wheel { delta: -30, at: t0 });
        assert_eq!(agg.wheel, [1, 1]);
        agg.handle(RawEvent::Wheel { delta: 90, at: t0 });
        agg.handle(RawEvent::Wheel { delta: 30, at: t0 });
        assert_eq!(agg.wheel, [2, 1]);
        assert_eq!(agg.bucket.wheel, [2, 1]);
    }

    #[test]
    fn pause_discards_and_clears_pressed() {
        let (mut agg, km) = new_agg();
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
        assert_eq!(agg.pressed.len(), 1);
        agg.set_paused(true);
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
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
        let shared = Shared::new(60);
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: false,
            at: t0 + Duration::from_millis(20),
            unmapped: None,
        });
        agg.handle(RawEvent::Button {
            btn: MouseBtn::Left,
            down: true,
            at: t0,
        });
        agg.handle(RawEvent::Wheel { delta: 120, at: t0 });
        agg.handle(RawEvent::AbsoluteMove { at: t0 });
        agg.flush(&shared);
        assert!(shared.snapshot.lock().stats.events > 0);

        agg.reset_session();
        shared.dropped.store(0, Ordering::Relaxed);
        agg.flush(&shared);
        let snap = shared.snapshot.lock().clone();
        assert_eq!(agg.counts[id as usize], 0);
        assert_eq!(agg.clicks, [0; 5]);
        assert_eq!(agg.wheel, [0, 0]);
        assert!(agg.pressed.is_empty());
        assert_eq!(snap.stats.events, 0);
        assert_eq!(snap.stats.key_events, 0);
        assert_eq!(snap.stats.mouse_events, 0);
        assert_eq!(snap.summary.keys, 0);
        assert!(snap.stats.running);
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
        assert_eq!(agg.counts[id as usize], 1);
    }

    #[test]
    fn absolute_mouse_move_is_skipped() {
        let (mut agg, _) = new_agg();
        let t0 = Instant::now();
        let before = agg.move_px;
        agg.handle(RawEvent::AbsoluteMove { at: t0 });
        assert_eq!(agg.absolute_skipped, 1);
        assert_eq!(agg.mouse_events, 1);
        assert_eq!(agg.move_px, before);
        assert_eq!(agg.events, 1);
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
        agg.handle(RawEvent::Key {
            key_id: None,
            down: true,
            at: t0,
            unmapped: Some(0x99),
        });
        agg.handle(RawEvent::Key {
            key_id: Some(9999),
            down: true,
            at: t0,
            unmapped: None,
        });
        assert_eq!(agg.unmapped, 2);
        assert_eq!(agg.counts.iter().sum::<u64>(), 0);
    }

    #[test]
    fn flush_emits_heartbeat_and_latency() {
        let (mut agg, km) = new_agg();
        let shared = Shared::new(60);
        let t0 = Instant::now();
        let id = key_id(&km, 0x11, false);
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
        std::thread::sleep(Duration::from_millis(5));
        agg.flush(&shared);
        let snap = shared.snapshot.lock().clone();
        assert_eq!(snap.stats.events, 1);
        assert_eq!(snap.stats.key_events, 1);
        assert!(snap.stats.running);
        assert_eq!(snap.summary.keys, 1);
        let seq_before = agg.seq;
        agg.flush(&shared);
        assert_eq!(agg.seq, seq_before + 1);
        assert_eq!(agg.snapshot(&Shared::new(60)).session.keys.len(), 1);
    }

    #[test]
    fn bucket_close_produces_payloads() {
        let (mut agg, km) = new_agg();
        let shared = Shared::new(60);
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: false,
            at: t0 + Duration::from_millis(80),
            unmapped: None,
        });
        agg.handle(RawEvent::Button {
            btn: MouseBtn::Right,
            down: true,
            at: t0 + Duration::from_millis(100),
        });
        agg.handle(RawEvent::Wheel {
            delta: 120,
            at: t0 + Duration::from_millis(150),
        });
        let (tx, rx) = crossbeam_channel::bounded(16);
        agg.writer = Some(tx);
        agg.close_bucket(&shared);
        let mut got = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            if let WriteMsg::Bucket(b) = msg {
                got.push(b);
            }
        }
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].device, Device::Kb);
        assert_eq!(got[0].actions, 1);
        let kb: KbPayload = crate::storage::payload::decode(&got[0].payload).unwrap();
        assert_eq!(kb.k.get(&id).copied(), Some(1));
        assert_eq!(kb.gap, [0; 5]);
        let mouse: MousePayload = crate::storage::payload::decode(&got[1].payload).unwrap();
        assert_eq!(mouse.cl[1], 1);
        assert_eq!(mouse.wh[0], 1);
    }

    #[test]
    fn streak_survives_bucket_close() {
        let (mut agg, km) = new_agg();
        let shared = Shared::new(60);
        let id = key_id(&km, 0x11, false);
        let t0 = Instant::now();
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: true,
            at: t0,
            unmapped: None,
        });
        agg.handle(RawEvent::Key {
            key_id: Some(id),
            down: false,
            at: t0 + Duration::from_millis(50),
            unmapped: None,
        });
        agg.close_bucket(&shared); // 桶关闭不应重置 streak 起点
        for i in 1..=150 {
            let at = t0 + Duration::from_secs(i * 4);
            agg.handle(RawEvent::Key {
                key_id: Some(id),
                down: true,
                at,
                unmapped: None,
            });
            agg.handle(RawEvent::Key {
                key_id: Some(id),
                down: false,
                at: at + Duration::from_millis(50),
                unmapped: None,
            });
        }
        // 最后一次事件距离第一次约 600s，连续（间隔 4s ≤ 5s）
        assert!(
            agg.longest_streak_ms >= 599_000,
            "streak={}",
            agg.longest_streak_ms
        );
    }

    #[test]
    fn error_marks_capture_unavailable() {
        let (agg, _) = new_agg();
        let shared = Shared::new(60);
        *shared.error.lock() = Some("Raw Input 不可用".into());
        let snap = agg.snapshot(&shared);
        assert!(!snap.stats.running);
        assert_eq!(snap.stats.error.as_deref(), Some("Raw Input 不可用"));
    }

    #[test]
    fn pair_counts_are_unordered_and_binned() {
        let (mut agg, km) = new_agg();
        let a = key_id(&km, 0x1e, false);
        let d = key_id(&km, 0x20, false);
        let t = Instant::now();

        // A down/up, D down/up, A down/up: A-D and D-A must merge into {A,D}.
        for (id, offset, down) in [
            (a, 0, true),
            (a, 30, false),
            (d, 70, true),
            (d, 100, false),
            (a, 150, true),
            (a, 180, false),
        ] {
            agg.handle(RawEvent::Key {
                key_id: Some(id),
                down,
                at: t + Duration::from_millis(offset),
                unmapped: None,
            });
        }

        let (lo, hi) = if a < d { (a, d) } else { (d, a) };
        let pair = ((lo as u32) << 16) | hi as u32;
        // D 与 A、A 与 D 各一次；第二次 A 与前一个 D 配对，但与自己不配对。
        assert_eq!(agg.bucket.pair.get(&pair).copied(), Some(2));
        let fast: u32 = agg
            .bucket
            .pair_gap
            .iter()
            .filter(|(k, _)| ((*k >> 3) as u32) == pair)
            .map(|(_, v)| *v)
            .sum();
        assert_eq!(fast, 2);
        // 70ms 落在 40–79ms 桶，80ms 落在 80–119ms 桶。
        assert_eq!(
            agg.bucket.pair_gap.get(&(((pair as u64) << 3) | 1)),
            Some(&1)
        );
        assert_eq!(
            agg.bucket.pair_gap.get(&(((pair as u64) << 3) | 2)),
            Some(&1)
        );
    }
}
