//! Writer 线程：独占 SQLite 写连接，后台落盘 + 预聚合 + 保留期清理。

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use chrono::{Local, TimeZone, Timelike};
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, Transaction};

use super::payload::{Device, KbPayload, MousePayload, PersistBucket, decode};
use super::{bump_data_version, purge_tx, read_meta_u64};

pub enum WriteMsg {
    Bucket(Box<PersistBucket>),
    Clear(Sender<Result<(), String>>),
    Purge,
    Shutdown(Sender<()>),
}

/// 启动 writer 线程；调用方持有 sender（Aggregator 克隆一份）与 JoinHandle（退出时 join）。
pub fn spawn(
    path: std::path::PathBuf,
    storage_error: Arc<Mutex<Option<String>>>,
) -> (Sender<WriteMsg>, std::thread::JoinHandle<()>) {
    let (tx, rx) = crossbeam_channel::bounded(1024);
    let handle = std::thread::Builder::new()
        .name("hp-writer".into())
        .spawn(move || {
            let conn = match Connection::open(&path) {
                Ok(c) => c,
                Err(err) => {
                    *storage_error.lock() = Some(format!("数据库打开失败：{err}"));
                    return;
                }
            };
            let _ = conn.busy_timeout(Duration::from_millis(5000));
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            let _ = conn.pragma_update(None, "synchronous", "NORMAL");
            let _ = conn.pragma_update(None, "foreign_keys", "ON");
            if let Ok(ret) = read_meta_u64(&conn, "retention_days") {
                let _ = purge_tx(&conn, ret.unwrap_or(30) as u32);
            }
            run(conn, rx, storage_error);
        })
        .expect("spawn hp-writer");
    (tx, handle)
}

fn run(mut conn: Connection, rx: Receiver<WriteMsg>, storage_error: Arc<Mutex<Option<String>>>) {
    let mut last_purge = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(WriteMsg::Bucket(bucket)) => {
                if let Err(err) = apply_bucket(&mut conn, &bucket) {
                    *storage_error.lock() = Some(format!("写入数据库失败：{err}"));
                }
            }
            Ok(WriteMsg::Clear(ack)) => {
                let res = clear_conn(&mut conn).map_err(|e| e.to_string());
                let _ = ack.send(res);
            }
            Ok(WriteMsg::Purge) => {
                let ret = read_meta_u64(&conn, "retention_days")
                    .ok()
                    .flatten()
                    .unwrap_or(30) as u32;
                if let Err(err) = purge_tx(&conn, ret) {
                    *storage_error.lock() = Some(format!("清理旧数据失败：{err}"));
                }
                last_purge = Instant::now();
            }
            Ok(WriteMsg::Shutdown(ack)) => {
                // channel 是 FIFO：收到 Shutdown 时之前的桶已处理完
                let _ = ack.send(());
                break;
            }
            Err(RecvTimeoutError::Timeout) => {
                // 启动清理 + 运行中每小时检查（04:00 的语义由清理窗口覆盖）
                if last_purge.elapsed() >= Duration::from_secs(3600) {
                    let ret = read_meta_u64(&conn, "retention_days")
                        .ok()
                        .flatten()
                        .unwrap_or(30) as u32;
                    if let Err(err) = purge_tx(&conn, ret) {
                        *storage_error.lock() = Some(format!("清理旧数据失败：{err}"));
                    }
                    last_purge = Instant::now();
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// 只供 writer 自身使用；避免 Db::clear_all 再开写连接。
pub fn clear_conn(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(
        "DELETE FROM bucket;
         DELETE FROM agg_hour;
         DELETE FROM agg_day;
         DELETE FROM key_day;
         DELETE FROM grid_day;
         DELETE FROM move_grid_day;
         DELETE FROM gap_day;
         DELETE FROM agg_mouse_day;
         DELETE FROM pad_bucket;",
    )?;
    bump_data_version(&tx)?;
    tx.commit()?;
    conn.execute_batch("VACUUM;")?;
    Ok(())
}

/// 落一个桶：事务内写 bucket + 预聚合。重复 (ts,granularity,device) 只覆盖行，
/// 不再叠加预聚合，避免重启/重放导致 today 翻倍。
pub fn apply_bucket(conn: &mut Connection, bucket: &PersistBucket) -> Result<()> {
    let tx = conn.transaction()?;
    let exists: bool = tx
        .query_row(
            "SELECT 1 FROM bucket WHERE ts=?1 AND granularity=?2 AND device=?3",
            rusqlite::params![bucket.ts, bucket.granularity, bucket.device.as_str()],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    tx.execute(
        "INSERT OR REPLACE INTO bucket(ts,granularity,device,actions,payload)
         VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![
            bucket.ts,
            bucket.granularity,
            bucket.device.as_str(),
            bucket.actions,
            bucket.payload
        ],
    )?;

    if !exists {
        match bucket.device {
            Device::Kb => {
                let p: KbPayload = decode(&bucket.payload)?;
                apply_kb(&tx, bucket.ts, &p)?;
            }
            Device::Mouse => {
                let p: MousePayload = decode(&bucket.payload)?;
                apply_mouse(&tx, bucket.ts, &p)?;
            }
        }
    }
    bump_data_version(&tx)?;
    tx.commit()?;
    Ok(())
}

fn local_hour_start(ts: i64) -> i64 {
    let dt = Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(Local::now);
    dt.date_naive()
        .and_hms_opt(dt.hour(), 0, 0)
        .and_then(|d| d.and_local_timezone(Local).single())
        .map(|d| d.timestamp())
        .unwrap_or(ts)
}

fn local_day(ts: i64) -> String {
    Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

fn apply_kb(tx: &Transaction<'_>, ts: i64, p: &KbPayload) -> Result<()> {
    let day = local_day(ts);
    let hour = local_hour_start(ts);
    let keys = p.keys();
    add_agg(tx, hour, &day, keys, 0, 0.0, p.streak_ms)?;

    for (id, count) in &p.k {
        let first = p.first.get(id).copied().unwrap_or(ts);
        let last = p.last.get(id).copied().unwrap_or(ts);
        let hold_sum = p.hold_sum.get(id).copied().unwrap_or(0);
        let hold_max = p.hold_max.get(id).copied().unwrap_or(0);
        tx.execute(
            "INSERT INTO key_day(day,key_id,count,hold_sum,hold_max,first_ts,last_ts)
             VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(day,key_id) DO UPDATE SET
               count=count+excluded.count,
               hold_sum=hold_sum+excluded.hold_sum,
               hold_max=MAX(hold_max,excluded.hold_max),
               first_ts=MIN(first_ts,excluded.first_ts),
               last_ts=MAX(last_ts,excluded.last_ts)",
            rusqlite::params![
                day,
                id,
                *count as i64,
                hold_sum as i64,
                hold_max as i64,
                first,
                last
            ],
        )?;
    }
    for (bin, count) in p.gap.iter().enumerate() {
        if *count == 0 {
            continue;
        }
        tx.execute(
            "INSERT INTO gap_day(day,bin,count) VALUES(?1,?2,?3)
             ON CONFLICT(day,bin) DO UPDATE SET count=count+excluded.count",
            rusqlite::params![day, bin as i64, *count as i64],
        )?;
    }
    Ok(())
}

fn apply_mouse(tx: &Transaction<'_>, ts: i64, p: &MousePayload) -> Result<()> {
    let day = local_day(ts);
    let hour = local_hour_start(ts);
    add_agg(tx, hour, &day, 0, p.clicks(), p.px, 0)?;
    tx.execute(
        "INSERT INTO agg_mouse_day(day,left,right,middle,side1,side2,wheel_up,wheel_down,peak_speed)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(day) DO UPDATE SET
           left=left+excluded.left, right=right+excluded.right,
           middle=middle+excluded.middle, side1=side1+excluded.side1, side2=side2+excluded.side2,
           wheel_up=wheel_up+excluded.wheel_up, wheel_down=wheel_down+excluded.wheel_down,
           peak_speed=MAX(peak_speed,excluded.peak_speed)",
        rusqlite::params![
            day,
            p.cl[0] as i64,
            p.cl[1] as i64,
            p.cl[2] as i64,
            p.cl[3] as i64,
            p.cl[4] as i64,
            p.wh[0] as i64,
            p.wh[1] as i64,
            p.vmax
        ],
    )?;
    for (key, count) in &p.grid {
        let Some((x, y)) = key.split_once(',') else {
            continue;
        };
        let (Ok(x), Ok(y)) = (x.parse::<i64>(), y.parse::<i64>()) else {
            continue;
        };
        tx.execute(
            "INSERT INTO grid_day(day,x,y,count) VALUES(?1,?2,?3,?4)
             ON CONFLICT(day,x,y) DO UPDATE SET count=count+excluded.count",
            rusqlite::params![day, x, y, *count as i64],
        )?;
    }
    for (key, count) in &p.mgrid {
        let Some((x, y)) = key.split_once(',') else {
            continue;
        };
        let (Ok(x), Ok(y)) = (x.parse::<i64>(), y.parse::<i64>()) else {
            continue;
        };
        tx.execute(
            "INSERT INTO move_grid_day(day,x,y,count) VALUES(?1,?2,?3,?4)
             ON CONFLICT(day,x,y) DO UPDATE SET count=count+excluded.count",
            rusqlite::params![day, x, y, *count as i64],
        )?;
    }
    Ok(())
}

fn add_agg(
    tx: &Transaction<'_>,
    hour: i64,
    day: &str,
    keys: u64,
    clicks: u64,
    move_px: f64,
    streak_ms: u64,
) -> Result<()> {
    let actions = keys + clicks;
    tx.execute(
        "INSERT INTO agg_hour(ts,actions,keys,clicks,move_px,streak_ms)
         VALUES(?1,?2,?3,?4,?5,?6)
         ON CONFLICT(ts) DO UPDATE SET
           actions=actions+excluded.actions,
           keys=keys+excluded.keys,
           clicks=clicks+excluded.clicks,
           move_px=move_px+excluded.move_px,
           streak_ms=MAX(streak_ms,excluded.streak_ms)",
        rusqlite::params![
            hour,
            actions as i64,
            keys as i64,
            clicks as i64,
            move_px,
            streak_ms as i64
        ],
    )?;
    tx.execute(
        "INSERT INTO agg_day(day,actions,keys,clicks,move_px,streak_ms)
         VALUES(?1,?2,?3,?4,?5,?6)
         ON CONFLICT(day) DO UPDATE SET
           actions=actions+excluded.actions,
           keys=keys+excluded.keys,
           clicks=clicks+excluded.clicks,
           move_px=move_px+excluded.move_px,
           streak_ms=MAX(streak_ms,excluded.streak_ms)",
        rusqlite::params![
            day,
            actions as i64,
            keys as i64,
            clicks as i64,
            move_px,
            streak_ms as i64
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::payload::{KbPayload, MousePayload, encode, px_to_cm};
    use crate::storage::schema;
    use crate::storage::set_meta;

    fn test_conn() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        schema::migrate(&mut c).unwrap();
        c
    }

    #[test]
    fn bucket_and_preaggregates_single_write() {
        let mut c = test_conn();
        let now = Local::now().timestamp();
        let mut p = KbPayload::default();
        p.k.insert(30, 3);
        p.hold_sum.insert(30, 300);
        p.hold_max.insert(30, 150);
        p.first.insert(30, now);
        p.last.insert(30, now);
        p.chord = 2;
        let b = PersistBucket::new(
            now - now.rem_euclid(60),
            60,
            Device::Kb,
            p.actions(),
            encode(&p).unwrap(),
        );
        apply_bucket(&mut c, &b).unwrap();

        let day = local_day(now);
        let (actions, keys, clicks): (i64, i64, i64) = c
            .query_row(
                "SELECT actions,keys,clicks FROM agg_day WHERE day=?1",
                [&day],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((actions, keys, clicks), (3, 3, 0));
        let cnt: i64 = c
            .query_row(
                "SELECT count FROM key_day WHERE day=?1 AND key_id=30",
                [&day],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 3);
    }

    #[test]
    fn duplicate_bucket_does_not_double_preaggregates() {
        let mut c = test_conn();
        let now = Local::now().timestamp();
        let mut p = KbPayload::default();
        p.k.insert(30, 5);
        let b = PersistBucket::new(
            now - now.rem_euclid(60),
            60,
            Device::Kb,
            p.actions(),
            encode(&p).unwrap(),
        );
        apply_bucket(&mut c, &b).unwrap();
        apply_bucket(&mut c, &b).unwrap();
        let day = local_day(now);
        let actions: i64 = c
            .query_row("SELECT actions FROM agg_day WHERE day=?1", [&day], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(actions, 5);
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM bucket", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn mouse_payload_writes_grid_and_move() {
        let mut c = test_conn();
        let now = Local::now().timestamp();
        let mut p = MousePayload::default();
        p.cl = [2, 1, 0, 0, 0];
        p.wh = [3, 1];
        p.px = 960.0;
        p.cm = px_to_cm(p.px);
        p.grid.insert("16,9".into(), 2);
        let b = PersistBucket::new(
            now - now.rem_euclid(60),
            60,
            Device::Mouse,
            p.actions(),
            encode(&p).unwrap(),
        );
        apply_bucket(&mut c, &b).unwrap();
        let day = local_day(now);
        let (actions, clicks, move_px): (i64, i64, f64) = c
            .query_row(
                "SELECT actions,clicks,move_px FROM agg_day WHERE day=?1",
                [&day],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((actions, clicks), (3, 3));
        assert!((move_px - 960.0).abs() < 1e-6);
        let cnt: i64 = c
            .query_row(
                "SELECT count FROM grid_day WHERE day=?1 AND x=16 AND y=9",
                [&day],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 2);
    }

    #[test]
    fn bad_payload_does_not_write() {
        let mut c = test_conn();
        let b = PersistBucket::new(0, 60, Device::Kb, 1, vec![1, 2, 3]);
        assert!(apply_bucket(&mut c, &b).is_err());
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM bucket", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn clear_empties_tables_and_keeps_meta() {
        let mut c = test_conn();
        set_meta(&c, "bucket_seconds", "10").unwrap();
        c.execute(
            "INSERT INTO bucket(ts,granularity,device,actions,payload) VALUES(1,60,'kb',1,x'00')",
            [],
        )
        .unwrap();
        clear_conn(&mut c).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM bucket", [], |r| r.get(0))
            .unwrap();
        let keys: i64 = c
            .query_row("SELECT COUNT(*) FROM key_def", [], |r| r.get(0))
            .unwrap();
        let meta: String = c
            .query_row(
                "SELECT value FROM meta WHERE key='bucket_seconds'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!((n, keys, meta.as_str()), (0, 104, "10"));
    }
}
