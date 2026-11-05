//! SQLite 存储层：schema 迁移、桶 payload、写入线程。

pub mod payload;
pub mod query;
pub mod schema;
pub mod writer;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use rusqlite::{Connection, OptionalExtension};

/// 采集/查询共享的数据库句柄；每次读写各自开连接，避免跨线程共用 Connection。
#[derive(Clone)]
pub struct Db {
    path: PathBuf,
}

impl Db {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("创建数据库目录失败: {}", parent.display()))?;
        }
        let db = Self { path };
        let mut conn = db.open_write()?;
        schema::migrate(&mut conn)?;
        Ok(db)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn open_write(&self) -> Result<Connection> {
        let conn = Connection::open(&self.path)
            .with_context(|| format!("打开数据库失败: {}", self.path.display()))?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }

    /// 查询连接：普通连接 + query_only，避免和 writer 抢写锁。
    pub fn open_read(&self) -> Result<Connection> {
        let conn = Connection::open(&self.path)
            .with_context(|| format!("打开数据库失败: {}", self.path.display()))?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        conn.pragma_update(None, "query_only", "ON")?;
        Ok(conn)
    }

    pub fn get_settings(&self) -> Result<Settings> {
        let conn = self.open_read()?;
        read_settings(&conn)
    }

    pub fn set_settings(&self, bucket_seconds: u32, retention_days: u32) -> Result<Settings> {
        if !matches!(bucket_seconds, 10 | 30 | 60) {
            return Err(anyhow!("桶粒度只支持 10 / 30 / 60 秒"));
        }
        if !matches!(retention_days, 7 | 30 | 90) {
            return Err(anyhow!("保留期只支持 7 / 30 / 90 天"));
        }
        let conn = self.open_write()?;
        let tx = conn.unchecked_transaction()?;
        set_meta(&tx, "bucket_seconds", &bucket_seconds.to_string())?;
        set_meta(&tx, "retention_days", &retention_days.to_string())?;
        bump_data_version(&tx)?;
        tx.commit()?;
        read_settings(&conn)
    }

    pub fn data_version(&self) -> Result<u64> {
        let conn = self.open_read()?;
        Ok(read_meta_u64(&conn, "data_version")?.unwrap_or(1))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub bucket_seconds: u32,
    pub retention_days: u32,
    pub db_path: String,
    pub schema_version: u32,
    pub data_version: u64,
}

pub fn read_settings(conn: &Connection) -> Result<Settings> {
    // open_read 的 path 在调用方拼接；这里用 PRAGMA database_list 取 main 路径
    let db_path: String = conn
        .query_row(
            "SELECT file FROM pragma_database_list WHERE name='main'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    Ok(Settings {
        bucket_seconds: read_meta_u64(conn, "bucket_seconds")?.unwrap_or(60) as u32,
        retention_days: read_meta_u64(conn, "retention_days")?.unwrap_or(30) as u32,
        db_path,
        schema_version: user_version(conn)?,
        data_version: read_meta_u64(conn, "data_version")?.unwrap_or(1),
    })
}

pub fn read_meta_u64(conn: &Connection, key: &str) -> Result<Option<u64>> {
    let v: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
        .optional()?;
    Ok(v.and_then(|s| s.parse().ok()))
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [key, value],
    )?;
    Ok(())
}

pub fn bump_data_version(conn: &Connection) -> Result<u64> {
    let next = read_meta_u64(conn, "data_version")?.unwrap_or(0) + 1;
    set_meta(conn, "data_version", &next.to_string())?;
    Ok(next)
}

pub fn user_version(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))?)
}

pub fn purge_tx(conn: &Connection, retention_days: u32) -> Result<()> {
    let days = retention_days.max(1) as i64;
    let now = chrono::Local::now();
    let cutoff_ts = (now - chrono::Duration::days(days)).timestamp();
    let cutoff_day = (now.date_naive() - chrono::Duration::days(days))
        .format("%Y-%m-%d")
        .to_string();
    conn.execute("DELETE FROM bucket WHERE ts < ?1", [cutoff_ts])?;
    conn.execute("DELETE FROM agg_hour WHERE ts < ?1", [cutoff_ts])?;
    conn.execute("DELETE FROM agg_day WHERE day < ?1", [&cutoff_day])?;
    conn.execute("DELETE FROM key_day WHERE day < ?1", [&cutoff_day])?;
    conn.execute("DELETE FROM grid_day WHERE day < ?1", [&cutoff_day])?;
    conn.execute("DELETE FROM move_grid_day WHERE day < ?1", [&cutoff_day])?;
    conn.execute("DELETE FROM gap_day WHERE day < ?1", [&cutoff_day])?;
    conn.execute("DELETE FROM agg_mouse_day WHERE day < ?1", [&cutoff_day])?;
    Ok(())
}
