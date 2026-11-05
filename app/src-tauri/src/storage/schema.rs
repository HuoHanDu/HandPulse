//! schema 迁移与 key_def 种子。

use anyhow::{Context, Result, anyhow};
use rusqlite::Connection;

pub const SCHEMA_VERSION: u32 = 1;

const MIGRATION_V1: &str = r#"
CREATE TABLE bucket (
  ts INTEGER NOT NULL,
  granularity INTEGER NOT NULL,
  device TEXT NOT NULL CHECK(device IN ('kb','mouse')),
  actions INTEGER NOT NULL,
  payload BLOB NOT NULL,
  PRIMARY KEY (ts, granularity, device)
);
CREATE INDEX idx_bucket_device_ts ON bucket(device, ts);

CREATE TABLE key_def (
  layout TEXT, key_id INTEGER, label TEXT,
  row INTEGER, col INTEGER, w REAL,
  PRIMARY KEY (layout, key_id)
);

CREATE TABLE pad_bucket (
  ts INTEGER, granularity INTEGER, device TEXT, payload BLOB,
  PRIMARY KEY (ts, granularity, device)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE agg_hour (
  ts INTEGER PRIMARY KEY,
  actions INTEGER NOT NULL,
  keys INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  move_px REAL NOT NULL,
  streak_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE agg_day (
  day TEXT PRIMARY KEY,
  actions INTEGER NOT NULL,
  keys INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  move_px REAL NOT NULL,
  streak_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE key_day (
  day TEXT NOT NULL,
  key_id INTEGER NOT NULL,
  count INTEGER NOT NULL,
  hold_sum INTEGER NOT NULL,
  hold_max INTEGER NOT NULL,
  first_ts INTEGER NOT NULL,
  last_ts INTEGER NOT NULL,
  PRIMARY KEY (day, key_id)
);

CREATE TABLE grid_day (
  day TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, x, y)
);

CREATE TABLE IF NOT EXISTS move_grid_day (
  day TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, x, y)
);

CREATE TABLE gap_day (
  day TEXT NOT NULL,
  bin INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, bin)
);

-- 鼠标分项日聚合（避免 30 天查询解 4 万+ payload）
CREATE TABLE IF NOT EXISTS agg_mouse_day (
  day TEXT PRIMARY KEY,
  left INTEGER NOT NULL,
  right INTEGER NOT NULL,
  middle INTEGER NOT NULL,
  side1 INTEGER NOT NULL,
  side2 INTEGER NOT NULL,
  wheel_up INTEGER NOT NULL,
  wheel_down INTEGER NOT NULL,
  peak_speed REAL NOT NULL
);
"#;

#[derive(serde::Deserialize)]
struct KeySeed {
    id: u16,
    label: String,
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    match v {
        0 => {
            let tx = conn.transaction()?;
            tx.execute_batch(MIGRATION_V1)?;
            seed_key_def(&tx)?;
            seed_meta(&tx)?;
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            tx.commit()?;
        }
        1 => {
            // 兼容早期空库：缺 key_def/meta 时补齐，不改 user_version
            let tx = conn.transaction()?;
            seed_key_def(&tx)?;
            seed_meta(&tx)?;
            tx.commit()?;
        }
        higher => {
            return Err(anyhow!(
                "数据库 schema 版本 {higher} 高于当前程序支持的 {SCHEMA_VERSION}，请升级 HandPulse"
            ));
        }
    }
    // v1 旧库补表（幂等）
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agg_mouse_day (
           day TEXT PRIMARY KEY,
           left INTEGER NOT NULL, right INTEGER NOT NULL, middle INTEGER NOT NULL,
           side1 INTEGER NOT NULL, side2 INTEGER NOT NULL,
           wheel_up INTEGER NOT NULL, wheel_down INTEGER NOT NULL,
           peak_speed REAL NOT NULL
         );
         CREATE TABLE IF NOT EXISTS move_grid_day (
           day TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
           count INTEGER NOT NULL, PRIMARY KEY(day,x,y)
         );",
    )?;
    Ok(())
}

fn seed_key_def(conn: &Connection) -> Result<()> {
    let keys: Vec<KeySeed> = serde_json::from_str(include_str!("../../keymap/qwerty-104.json"))
        .context("解析 keymap/qwerty-104.json 失败")?;
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO key_def(layout,key_id,label,row,col,w) VALUES('qwerty-104',?1,?2,?3,?4,?5)",
    )?;
    for k in keys {
        stmt.execute(rusqlite::params![k.id, k.label, 0, 0, 1.0])?;
    }
    Ok(())
}

fn seed_meta(conn: &Connection) -> Result<()> {
    for (k, v) in [
        ("schema_version", SCHEMA_VERSION.to_string()),
        ("retention_days", "30".to_string()),
        ("bucket_seconds", "60".to_string()),
        ("data_version", "1".to_string()),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO meta(key,value) VALUES(?1,?2)",
            [k, &v],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn migrate_empty_v0_and_reopen() {
        let mut c = mem();
        migrate(&mut c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            1
        );
        let keys: u32 = c
            .query_row("SELECT COUNT(*) FROM key_def", [], |r| r.get(0))
            .unwrap();
        assert_eq!(keys, 104);
        let pad: u32 = c
            .query_row("SELECT COUNT(*) FROM pad_bucket", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pad, 0);
        // 再次迁移 no-op
        migrate(&mut c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn migrate_rejects_newer_version() {
        let mut c = mem();
        c.pragma_update(None, "user_version", 2).unwrap();
        let err = migrate(&mut c).unwrap_err().to_string();
        assert!(err.contains("高于当前程序支持"));
    }

    #[test]
    fn meta_defaults() {
        let mut c = mem();
        migrate(&mut c).unwrap();
        let ret: String = c
            .query_row(
                "SELECT value FROM meta WHERE key='retention_days'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ret, "30");
        let gran: String = c
            .query_row(
                "SELECT value FROM meta WHERE key='bucket_seconds'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gran, "60");
    }
}
