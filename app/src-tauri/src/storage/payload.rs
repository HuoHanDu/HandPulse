//! 桶 payload：zstd(JSON)，只存聚合计数，不存按键顺序/输入内容。

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub const KEY_COUNT: usize = 104;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct KbPayload {
    pub v: u8,
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
    /// left/right/middle/side1/side2
    pub cl: [u64; 5],
    pub wh: [u64; 2],
    pub px: f64,
    /// 固定 96 DPI 估算：px * 2.54 / 96
    pub cm: u64,
    pub vmax: f64,
    pub fast: u64,
    /// "x,y" -> count
    pub grid: BTreeMap<String, u32>,
}

impl Default for MousePayload {
    fn default() -> Self {
        Self {
            v: 1,
            cl: [0; 5],
            wh: [0; 2],
            px: 0.0,
            cm: 0,
            vmax: 0.0,
            fast: 0,
            grid: BTreeMap::new(),
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
}

impl MousePayload {
    pub fn actions(&self) -> u64 {
        self.cl.iter().sum()
    }

    pub fn clicks(&self) -> u64 {
        self.cl.iter().sum()
    }
}

pub fn px_to_cm(px: f64) -> u64 {
    (px * 2.54 / 96.0).round() as u64
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Device {
    Kb,
    Mouse,
}

impl Device {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Kb => "kb",
            Self::Mouse => "mouse",
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
