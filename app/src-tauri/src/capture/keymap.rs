//! 104 键 keymap。
//!
//! keyId 唯一标准是前端 `app/src/mock/mock.ts` 里 `HP.keyboard.keys` 的数组顺序（0–103）。
//! `qwerty-104.json` 的 `id`/`label` 与该顺序逐项一致（`frontend-labels.json` 是前端顺序的 fixture，
//! 由同一份 mock 生成，keymap 单测会逐项比对）。

use std::collections::HashMap;

use serde::Deserialize;

const KEYMAP_JSON: &str = include_str!("../../keymap/qwerty-104.json");
#[cfg(test)]
const FRONTEND_LABELS_JSON: &str = include_str!("../../keymap/frontend-labels.json");

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct KeyDef {
    pub id: u16,
    pub label: String,
    pub scan: u16,
    pub extended: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct KeyDefJson {
    id: u16,
    label: String,
    scan: u16,
    extended: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum KeymapError {
    #[error("keymap JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    #[error("keymap 数量错误: {0}")]
    Count(usize),
    #[error("keymap id 不连续: 期望 {expected}, 实际 {actual}")]
    IdGap { expected: u16, actual: u16 },
    #[error("scan/extended 重复: scan={scan} extended={extended} ({label})")]
    Duplicate { scan: u16, extended: bool, label: String },
}

pub struct Keymap {
    pub defs: Vec<KeyDef>,
    lookup: HashMap<(u16, bool), u16>,
}

impl Keymap {
    pub fn parse(json: &str) -> Result<Self, KeymapError> {
        let defs: Vec<KeyDefJson> = serde_json::from_str(json)?;
        if defs.len() != 104 {
            return Err(KeymapError::Count(defs.len()));
        }
        let mut lookup = HashMap::with_capacity(128);
        let mut out = Vec::with_capacity(104);
        for (i, d) in defs.into_iter().enumerate() {
            if d.id != i as u16 {
                return Err(KeymapError::IdGap { expected: i as u16, actual: d.id });
            }
            if lookup.insert((d.scan, d.extended), d.id).is_some() {
                return Err(KeymapError::Duplicate { scan: d.scan, extended: d.extended, label: d.label });
            }
            out.push(KeyDef { id: d.id, label: d.label, scan: d.scan, extended: d.extended });
        }
        Ok(Self { defs: out, lookup })
    }

    /// 扫描码 + E0 标志 → keyId；未映射返回 None。
    pub fn id_for(&self, scan: u16, extended: bool) -> Option<u16> {
        self.lookup.get(&(scan, extended)).copied()
    }

    #[allow(dead_code)]
    pub fn label_of(&self, id: u16) -> Option<&str> {
        self.defs.get(id as usize).map(|d| d.label.as_str())
    }
}

pub fn load() -> Keymap {
    Keymap::parse(KEYMAP_JSON).expect("内置 keymap 必须有效")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frontend_labels() -> Vec<String> {
        serde_json::from_str(FRONTEND_LABELS_JSON).expect("frontend labels fixture")
    }

    #[test]
    fn keymap_has_104_continuous_ids() {
        let km = load();
        assert_eq!(km.defs.len(), 104);
        for (i, def) in km.defs.iter().enumerate() {
            assert_eq!(def.id, i as u16, "id 必须连续");
        }
    }

    #[test]
    fn labels_match_frontend_order() {
        let km = load();
        let expected = frontend_labels();
        assert_eq!(expected.len(), 104);
        let actual: Vec<&str> = km.defs.iter().map(|d| d.label.as_str()).collect();
        assert_eq!(actual, expected.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    }

    #[test]
    fn scan_codes_unique_per_extended_flag() {
        let km = load();
        let mut seen = std::collections::HashSet::new();
        for def in &km.defs {
            assert!(seen.insert((def.scan, def.extended)), "重复 scan/extended: {} {}", def.scan, def.label);
        }
    }

    #[test]
    fn lookup_handles_base_and_extended_keys() {
        let km = load();
        assert_eq!(km.id_for(0x11, false).map(|id| km.label_of(id).unwrap()), Some("W"));
        assert_eq!(km.id_for(0x48, true).map(|id| km.label_of(id).unwrap()), Some("↑"));
        assert_eq!(km.id_for(0x47, false).map(|id| km.label_of(id).unwrap()), Some("N7"));
        assert_eq!(km.id_for(0x47, true).map(|id| km.label_of(id).unwrap()), Some("Home"));
        assert_eq!(km.id_for(0x99, false), None);
    }
}
