//! 桶 payload：zstd(JSON)，只存聚合计数，不存按键顺序/输入内容。

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub const KEY_COUNT: usize = 104;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct KbPayload {
    pub v: u8,
    /// 本次启动的会话 id；用于区分“重放同一个桶”和“同一分钟的新不完整桶”。
    #[serde(default)]
    pub session: u64,
    /// key_id -> 次数
    pub k: BTreeMap<u16, u32>,
    pub hold_sum: BTreeMap<u16, u64>,
    pub hold_max: BTreeMap<u16, u64>,
    pub chord: u64,
    pub gap: [u32; 5],
    pub streak_ms: u64,
    /// 键位首次/最近出现（本地 unix 秒，附加字段，服务 get_key_stats）
    #[serde(default)]
    pub first: BTreeMap<u16, i64>,
    #[serde(default)]
    pub last: BTreeMap<u16, i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MousePayload {
    pub v: u8,
    #[serde(default)]
    pub session: u64,
    /// left/right/middle/side1/side2
    pub cl: [u64; 5],
    pub wh: [u64; 2],
    pub px: f64,
    /// 固定 96 DPI 估算：px * 2.54 / 96
    pub cm: u64,
    pub vmax: f64,
    pub fast: u64,
    /// "x,y" -> count（点击）
    pub grid: BTreeMap<String, u32>,
    /// "x,y" -> count（移动采样，50ms 一次）
    #[serde(default)]
    pub mgrid: BTreeMap<String, u32>,
}

impl Default for MousePayload {
    fn default() -> Self {
        Self {
            v: 1,
            session: 0,
            cl: [0; 5],
            wh: [0; 2],
            px: 0.0,
            cm: 0,
            vmax: 0.0,
            fast: 0,
            grid: BTreeMap::new(),
            mgrid: BTreeMap::new(),
        }
    }
}

impl KbPayload {
    pub fn actions(&self) -> u64 {
        self.k.values().map(|v| *v as u64).sum()
    }

    pub fn keys(&self) -> u64 {
        self.k.values().map(|v| *v as u64).sum()
    }

    /// 同一分钟内正常关闭→重开→再关闭会生成两个不完整桶；
    /// 合并 payload，避免桶行被后者覆盖而“回档”。
    pub fn merge(&mut self, other: &Self) {
        self.v = self.v.max(other.v);
        self.session = other.session;
        for (id, count) in &other.k {
            *self.k.entry(*id).or_default() += *count;
        }
        for (id, hold) in &other.hold_sum {
            *self.hold_sum.entry(*id).or_default() += *hold;
        }
        for (id, hold) in &other.hold_max {
            let entry = self.hold_max.entry(*id).or_default();
            *entry = (*entry).max(*hold);
        }
        self.chord += other.chord;
        for (a, b) in self.gap.iter_mut().zip(other.gap.iter()) {
            *a = a.saturating_add(*b);
        }
        self.streak_ms = self.streak_ms.max(other.streak_ms);
        for (id, ts) in &other.first {
            let entry = self.first.entry(*id).or_insert(*ts);
            *entry = (*entry).min(*ts);
        }
        for (id, ts) in &other.last {
            let entry = self.last.entry(*id).or_insert(*ts);
            *entry = (*entry).max(*ts);
        }
    }
}

impl MousePayload {
    pub fn actions(&self) -> u64 {
        self.cl.iter().sum()
    }

    pub fn clicks(&self) -> u64 {
        self.cl.iter().sum()
    }

    /// 同 KbPayload::merge：同一分钟的不完整桶合并，而不是覆盖。
    pub fn merge(&mut self, other: &Self) {
        self.v = self.v.max(other.v);
        self.session = other.session;
        for (a, b) in self.cl.iter_mut().zip(other.cl.iter()) {
            *a = a.saturating_add(*b);
        }
        for (a, b) in self.wh.iter_mut().zip(other.wh.iter()) {
            *a = a.saturating_add(*b);
        }
        self.px += other.px;
        self.cm = self.cm.saturating_add(other.cm);
        self.vmax = self.vmax.max(other.vmax);
        self.fast = self.fast.saturating_add(other.fast);
        for (cell, count) in &other.grid {
            *self.grid.entry(cell.clone()).or_default() += *count;
        }
        for (cell, count) in &other.mgrid {
            *self.mgrid.entry(cell.clone()).or_default() += *count;
        }
    }
}

pub fn px_to_cm(px: f64) -> u64 {
    (px * 2.54 / 96.0).round() as u64
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct PadPayload {
    pub v: u8,
    #[serde(default)]
    pub session: u64,
    /// 标准 17 键的按下次数：A/B/X/Y/LB/RB/LT/RT/Back/Start/LS/RS/Up/Down/Left/Right/Home
    pub buttons: BTreeMap<u8, u32>,
}

impl PadPayload {
    pub fn actions(&self) -> u64 {
        self.buttons.values().map(|v| *v as u64).sum()
    }

    pub fn merge(&mut self, other: &Self) {
        self.v = self.v.max(other.v);
        self.session = other.session;
        for (id, count) in &other.buttons {
            *self.buttons.entry(*id).or_default() += *count;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Device {
    Kb,
    Mouse,
    Pad,
}

impl Device {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Kb => "kb",
            Self::Mouse => "mouse",
            Self::Pad => "pad",
        }
    }
}

#[derive(Clone, Debug)]
pub struct PersistBucket {
    pub ts: i64,
    pub granularity: u32,
    pub device: Device,
    pub actions: u64,
    pub payload: Vec<u8>,
}

impl PersistBucket {
    pub fn new(ts: i64, granularity: u32, device: Device, actions: u64, payload: Vec<u8>) -> Self {
        Self {
            ts,
            granularity,
            device,
            actions,
            payload,
        }
    }
}

/// 当前未关闭桶；查询 `today` 时补上它，避免和 DB 重复。
#[derive(Clone, Debug, Default, Serialize)]
pub struct CurrentBucket {
    pub ts: i64,
    pub granularity: u32,
    pub kb: KbPayload,
    pub mouse: MousePayload,
}

pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(value).context("payload JSON 序列化失败")?;
    zstd::stream::encode_all(&json[..], 3).context("payload zstd 压缩失败")
}

pub fn decode<T: for<'de> Deserialize<'de>>(blob: &[u8]) -> Result<T> {
    let json = zstd::stream::decode_all(blob).context("payload zstd 解压失败")?;
    serde_json::from_slice(&json).context("payload JSON 反序列化失败")
}
