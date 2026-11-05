//! 历史查询：优先读预聚合表；只有鼠标分项/峰值等必要字段才解 payload。

use std::collections::{BTreeMap, HashMap};

use anyhow::{Result, anyhow};
use chrono::{Datelike, Duration as ChronoDuration, Local, NaiveDate, TimeZone, Timelike};
use rusqlite::Connection;
use serde::Serialize;

use super::Db;
use super::payload::{CurrentBucket, MousePayload, decode, px_to_cm};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Range {
    Session,
    Today,
    Week,
    Month,
}

impl Range {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "session" => Ok(Self::Session),
            "today" => Ok(Self::Today),
            "week" => Ok(Self::Week),
            "month" => Ok(Self::Month),
            other => Err(anyhow!("非法时间范围: {other}")),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct LiveKey {
    pub key_id: u16,
    pub count: u64,
    pub hold_sum: u64,
    pub hold_max: u64,
    pub first_min: u32,
    pub last_min: u32,
}

#[derive(Clone, Debug, Default)]
pub struct LiveSnapshot {
    pub keys: Vec<LiveKey>,
    pub clicks: [u64; 5],
    pub wheel: [u64; 2],
    pub move_px: f64,
    pub peak_speed: f64,
    pub grid: Vec<(u8, u8, u32)>,
    pub current: Option<CurrentBucket>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub actions: u64,
    pub keys: u64,
    pub clicks: u64,
    pub move_km: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStat {
    pub key_id: u16,
    pub label: String,
    pub count: u64,
    pub ratio: f64,
    pub hold_avg_ms: u64,
    pub hold_max_ms: u64,
    pub first_ts: u32,
    pub last_ts: u32,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClickBreakdown {
    pub left: u64,
    pub right: u64,
    pub middle: u64,
    pub side1: u64,
    pub side2: u64,
    pub total: u64,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MouseStats {
    pub clicks: ClickBreakdown,
    pub wheel: [u64; 2],
    pub peak_speed: f64,
    pub move_km: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketPoint {
    pub ts: i64,
    pub actions: u64,
    pub keys: u64,
    pub clicks: u64,
    pub move_px: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Histogram {
    pub dim: String,
    pub items: Vec<HistItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistItem {
    pub label: String,
    pub value: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heatmap {
    pub r#type: String,
    pub cells: Vec<HeatCell>,
    pub max: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatCell {
    pub x: i64,
    pub y: i64,
    pub v: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridCell {
    pub x: i64,
    pub y: i64,
    pub v: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRow {
    pub ts: i64,
    pub label: String,
    pub actions: u64,
    pub keys: u64,
    pub clicks: u64,
    pub move_cm: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailPage {
    pub rows: Vec<DetailRow>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
    pub gran_label: String,
}

struct Bounds {
    start_ts: i64,
    end_ts: i64,
    start_day: String,
    end_day: String,
}

fn now_local() -> chrono::DateTime<Local> {
    Local::now()
}

fn day_start(d: NaiveDate) -> i64 {
    d.and_hms_opt(0, 0, 0)
        .and_then(|dt| dt.and_local_timezone(Local).single())
        .map(|dt| dt.timestamp())
        .unwrap_or_else(|| Local::now().timestamp())
}

fn bounds(range: Range) -> Result<Bounds> {
    let now = now_local();
    let today = now.date_naive();
    let end_ts = now.timestamp() + 1;
    let (start_date, end_date) = match range {
        Range::Session => return Err(anyhow!("session 不读数据库")),
        Range::Today => (today, today),
        Range::Week => (today - ChronoDuration::days(6), today),
        Range::Month => (today - ChronoDuration::days(29), today),
    };
    Ok(Bounds {
        start_ts: day_start(start_date),
        end_ts,
        start_day: start_date.format("%Y-%m-%d").to_string(),
        end_day: end_date.format("%Y-%m-%d").to_string(),
    })
}

fn minute_of_day(ts: i64) -> u32 {
    let dt = Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(now_local);
    dt.hour() * 60 + dt.minute()
}

fn weekday_label(ts: i64) -> String {
    let wd = Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(now_local)
        .weekday();
    match wd.num_days_from_monday() {
        0 => "周一".into(),
        1 => "周二".into(),
        2 => "周三".into(),
        3 => "周四".into(),
        4 => "周五".into(),
        5 => "周六".into(),
        _ => "周日".into(),
    }
}

fn weekday_index(ts: i64) -> i64 {
    Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(now_local)
        .weekday()
        .num_days_from_monday() as i64
}

fn current_bucket(live: &LiveSnapshot) -> Option<&CurrentBucket> {
    live.current.as_ref()
}

fn in_range_current(cur: &CurrentBucket, b: &Bounds) -> bool {
    cur.ts >= b.start_ts && cur.ts < b.end_ts
}

fn key_labels(conn: &Connection) -> Result<HashMap<u16, String>> {
    let mut stmt = conn.prepare("SELECT key_id,label FROM key_def WHERE layout='qwerty-104'")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, u16>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = HashMap::new();
    for row in rows {
        let (id, label) = row?;
        out.insert(id, label);
    }
    Ok(out)
}

pub fn summary(db: &Db, range: Range, live: &LiveSnapshot) -> Result<Summary> {
    if range == Range::Session {
        let keys: u64 = live.keys.iter().map(|k| k.count).sum();
        let clicks: u64 = live.clicks.iter().sum();
        return Ok(Summary {
            actions: keys + clicks,
            keys,
            clicks,
            move_km: px_to_cm(live.move_px) as f64 / 100_000.0,
        });
    }
    let b = bounds(range)?;
    let conn = db.open_read()?;
    let (mut keys, mut clicks, mut move_px): (u64, u64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(keys),0),COALESCE(SUM(clicks),0),COALESCE(SUM(move_px),0)
         FROM agg_day WHERE day BETWEEN ?1 AND ?2",
        [&b.start_day, &b.end_day],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
        keys += cur.kb.keys();
        clicks += cur.mouse.clicks();
        move_px += cur.mouse.px;
    }
    Ok(Summary {
        actions: keys + clicks,
        keys,
        clicks,
        move_km: px_to_cm(move_px) as f64 / 100_000.0,
    })
}

pub fn key_stats(db: &Db, range: Range, live: &LiveSnapshot) -> Result<Vec<KeyStat>> {
    let conn = db.open_read()?;
    let labels = key_labels(&conn)?;
    let mut agg: BTreeMap<u16, (u64, u64, u64, i64, i64)> = BTreeMap::new();

    if range == Range::Session {
        for k in &live.keys {
            agg.insert(
                k.key_id,
                (
                    k.count,
                    k.hold_sum,
                    k.hold_max,
                    k.first_min as i64,
                    k.last_min as i64,
                ),
            );
        }
    } else {
        let b = bounds(range)?;
        let mut stmt = conn.prepare(
            "SELECT key_id,SUM(count),SUM(hold_sum),MAX(hold_max),MIN(first_ts),MAX(last_ts)
             FROM key_day WHERE day BETWEEN ?1 AND ?2 GROUP BY key_id",
        )?;
        let rows = stmt.query_map([&b.start_day, &b.end_day], |r| {
            Ok((
                r.get::<_, u16>(0)?,
                r.get::<_, u64>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, u64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })?;
        for row in rows {
            let (id, count, hold_sum, hold_max, first, last) = row?;
            let e = agg.entry(id).or_insert((0, 0, 0, i64::MAX, i64::MIN));
            e.0 += count;
            e.1 += hold_sum;
            e.2 = e.2.max(hold_max);
            e.3 = e.3.min(first);
            e.4 = e.4.max(last);
        }
        if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
            for (id, count) in &cur.kb.k {
                let e = agg.entry(*id).or_insert((0, 0, 0, b.start_ts, b.start_ts));
                e.0 += *count as u64;
                e.1 += cur.kb.hold_sum.get(id).copied().unwrap_or(0);
                e.2 = e.2.max(cur.kb.hold_max.get(id).copied().unwrap_or(0));
                e.3 = e.3.min(*cur.kb.first.get(id).unwrap_or(&cur.ts));
                e.4 = e.4.max(*cur.kb.last.get(id).unwrap_or(&cur.ts));
            }
        }
    }

    let total: u64 = agg.values().map(|v| v.0).sum();
    let mut out = Vec::new();
    for id in 0..super::payload::KEY_COUNT as u16 {
        let label = labels.get(&id).cloned().unwrap_or_default();
        if label.is_empty() {
            continue;
        }
        let (count, hold_sum, hold_max, first, last) =
            agg.get(&id).copied().unwrap_or((0, 0, 0, 0, 0));
        let (first_ts, last_ts) = if range == Range::Session {
            (first.max(0) as u32, last.max(0) as u32)
        } else {
            (
                if first > 0 { minute_of_day(first) } else { 0 },
                if last > 0 { minute_of_day(last) } else { 0 },
            )
        };
        out.push(KeyStat {
            key_id: id,
            label,
            count,
            ratio: if total > 0 {
                count as f64 / total as f64
            } else {
                0.0
            },
            hold_avg_ms: hold_sum.checked_div(count).unwrap_or(0),
            hold_max_ms: hold_max,
            first_ts,
            last_ts,
        });
    }
    out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
    Ok(out)
}

pub fn mouse_stats(db: &Db, range: Range, live: &LiveSnapshot) -> Result<MouseStats> {
    if range == Range::Session {
        return Ok(mouse_from(
            live.clicks,
            live.wheel,
            live.move_px,
            live.peak_speed,
        ));
    }
    let b = bounds(range)?;
    let conn = db.open_read()?;
    let (left, right, middle, side1, side2, wheel_up, wheel_down, mut peak): (
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
        f64,
    ) = conn.query_row(
        "SELECT COALESCE(SUM(left),0),COALESCE(SUM(right),0),COALESCE(SUM(middle),0),
                COALESCE(SUM(side1),0),COALESCE(SUM(side2),0),
                COALESCE(SUM(wheel_up),0),COALESCE(SUM(wheel_down),0),
                COALESCE(MAX(peak_speed),0)
         FROM agg_mouse_day WHERE day BETWEEN ?1 AND ?2",
        [&b.start_day, &b.end_day],
        |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        },
    )?;
    let mut clicks = [left, right, middle, side1, side2];
    let mut wheel = [wheel_up, wheel_down];
    let (db_px,): (f64,) = conn.query_row(
        "SELECT COALESCE(SUM(move_px),0) FROM agg_day WHERE day BETWEEN ?1 AND ?2",
        [&b.start_day, &b.end_day],
        |r| Ok((r.get(0)?,)),
    )?;
    let mut px = db_px;
    // 旧库/表刚建立时 agg_mouse_day 可能为空：回退到解 payload
    if clicks.iter().all(|v| *v == 0) && wheel == [0, 0] && peak == 0.0 {
        let mut stmt =
            conn.prepare("SELECT payload FROM bucket WHERE device='mouse' AND ts>=?1 AND ts<?2")?;
        let rows = stmt.query_map([b.start_ts, b.end_ts], |r| r.get::<_, Vec<u8>>(0))?;
        for row in rows {
            let p: MousePayload = decode(&row?)?;
            for (i, c) in clicks.iter_mut().enumerate() {
                *c += p.cl[i];
            }
            wheel[0] += p.wh[0];
            wheel[1] += p.wh[1];
            peak = peak.max(p.vmax);
        }
    }
    if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
        for (i, c) in clicks.iter_mut().enumerate() {
            *c += cur.mouse.cl[i];
        }
        wheel[0] += cur.mouse.wh[0];
        wheel[1] += cur.mouse.wh[1];
        px += cur.mouse.px;
        peak = peak.max(cur.mouse.vmax);
    }
    Ok(mouse_from(clicks, wheel, px, peak))
}

fn mouse_from(clicks: [u64; 5], wheel: [u64; 2], px: f64, peak: f64) -> MouseStats {
    let total = clicks.iter().sum();
    MouseStats {
        clicks: ClickBreakdown {
            left: clicks[0],
            right: clicks[1],
            middle: clicks[2],
            side1: clicks[3],
            side2: clicks[4],
            total,
        },
        wheel,
        peak_speed: peak,
        move_km: px_to_cm(px) as f64 / 100_000.0,
    }
}

pub fn buckets(db: &Db, range: Range, live: &LiveSnapshot) -> Result<Vec<BucketPoint>> {
    if range == Range::Session {
        return Ok(Vec::new());
    }
    let b = bounds(range)?;
    let conn = db.open_read()?;
    let mut out: BTreeMap<i64, BucketPoint> = BTreeMap::new();
    match range {
        Range::Today => {
            let mut stmt = conn.prepare(
                "SELECT (ts/60)*60 AS m,
                        SUM(CASE WHEN device='kb' THEN actions ELSE 0 END) AS keys,
                        SUM(CASE WHEN device='mouse' THEN actions ELSE 0 END) AS clicks
                 FROM bucket WHERE ts>=?1 AND ts<?2 GROUP BY m ORDER BY m",
            )?;
            let rows = stmt.query_map([b.start_ts, b.end_ts], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, u64>(1)?,
                    r.get::<_, u64>(2)?,
                ))
            })?;
            for row in rows {
                let (m, keys, clicks) = row?;
                out.insert(
                    m,
                    BucketPoint {
                        ts: m * 1000,
                        actions: keys + clicks,
                        keys,
                        clicks,
                        move_px: 0.0,
                    },
                );
            }
        }
        Range::Week => {
            let mut stmt = conn.prepare(
                "SELECT ts,actions,keys,clicks,move_px FROM agg_hour WHERE ts>=?1 AND ts<?2 ORDER BY ts",
            )?;
            let rows = stmt.query_map([b.start_ts, b.end_ts], |r| {
                Ok(BucketPoint {
                    ts: r.get::<_, i64>(0)? * 1000,
                    actions: r.get::<_, u64>(1)?,
                    keys: r.get::<_, u64>(2)?,
                    clicks: r.get::<_, u64>(3)?,
                    move_px: r.get::<_, f64>(4)?,
                })
            })?;
            for row in rows {
                let p = row?;
                out.insert(p.ts, p);
            }
        }
        Range::Month => {
            let mut stmt = conn.prepare(
                "SELECT day,actions,keys,clicks,move_px FROM agg_day WHERE day BETWEEN ?1 AND ?2 ORDER BY day",
            )?;
            let rows = stmt.query_map([&b.start_day, &b.end_day], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, u64>(1)?,
                    r.get::<_, u64>(2)?,
                    r.get::<_, u64>(3)?,
                    r.get::<_, f64>(4)?,
                ))
            })?;
            for row in rows {
                let (day, actions, keys, clicks, move_px) = row?;
                let ts = parse_day(&day) * 1000;
                out.insert(
                    ts,
                    BucketPoint {
                        ts,
                        actions,
                        keys,
                        clicks,
                        move_px,
                    },
                );
            }
        }
        Range::Session => {}
    }
    if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
        let period = match range {
            Range::Today => (cur.ts / 60) * 60,
            Range::Week => {
                let dt = Local
                    .timestamp_opt(cur.ts, 0)
                    .single()
                    .unwrap_or_else(now_local);
                dt.date_naive()
                    .and_hms_opt(dt.hour(), 0, 0)
                    .and_then(|d| d.and_local_timezone(Local).single())
                    .map(|d| d.timestamp())
                    .unwrap_or(cur.ts)
            }
            Range::Month => day_start(
                Local
                    .timestamp_opt(cur.ts, 0)
                    .single()
                    .unwrap_or_else(now_local)
                    .date_naive(),
            ),
            Range::Session => cur.ts,
        };
        let p = out.entry(period * 1000).or_insert(BucketPoint {
            ts: period * 1000,
            actions: 0,
            keys: 0,
            clicks: 0,
            move_px: 0.0,
        });
        let keys = cur.kb.keys();
        let clicks = cur.mouse.clicks();
        p.keys += keys;
        p.clicks += clicks;
        p.actions += keys + clicks;
        p.move_px += cur.mouse.px;
    }
    Ok(out.into_values().collect())
}

pub fn histogram(db: &Db, range: Range, dim: &str, live: &LiveSnapshot) -> Result<Histogram> {
    match dim {
        "key" | "top20" => {
            let stats = key_stats(db, range, live)?;
            let items = stats
                .into_iter()
                .filter(|s| s.count > 0)
                .take(20)
                .map(|s| HistItem {
                    label: s.label,
                    value: s.count,
                })
                .collect();
            Ok(Histogram {
                dim: "key".into(),
                items,
            })
        }
        "hour" | "hours" => {
            let mut vals = [0u64; 24];
            if range == Range::Session {
                // session 只给当前小时
                if let Some(cur) = current_bucket(live) {
                    let h = Local
                        .timestamp_opt(cur.ts, 0)
                        .single()
                        .unwrap_or_else(now_local)
                        .hour() as usize;
                    vals[h] += cur.kb.keys() + cur.mouse.clicks();
                }
            } else {
                let b = bounds(range)?;
                let conn = db.open_read()?;
                let mut stmt =
                    conn.prepare("SELECT ts,actions FROM agg_hour WHERE ts>=?1 AND ts<?2")?;
                let rows = stmt.query_map([b.start_ts, b.end_ts], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, u64>(1)?))
                })?;
                for row in rows {
                    let (ts, actions) = row?;
                    let h = Local
                        .timestamp_opt(ts, 0)
                        .single()
                        .unwrap_or_else(now_local)
                        .hour() as usize;
                    vals[h] += actions;
                }
                if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
                    let h = Local
                        .timestamp_opt(cur.ts, 0)
                        .single()
                        .unwrap_or_else(now_local)
                        .hour() as usize;
                    vals[h] += cur.kb.keys() + cur.mouse.clicks();
                }
            }
            Ok(Histogram {
                dim: "hour".into(),
                items: vals
                    .iter()
                    .enumerate()
                    .map(|(i, v)| HistItem {
                        label: format!("{i:02}"),
                        value: *v,
                    })
                    .collect(),
            })
        }
        "gap" | "gaps" => {
            let mut vals = [0u64; 5];
            if range == Range::Session {
                if let Some(cur) = current_bucket(live) {
                    for (i, v) in cur.kb.gap.iter().enumerate() {
                        vals[i] += *v as u64;
                    }
                }
            } else {
                let b = bounds(range)?;
                let conn = db.open_read()?;
                let mut stmt = conn.prepare(
                    "SELECT bin,SUM(count) FROM gap_day WHERE day BETWEEN ?1 AND ?2 GROUP BY bin",
                )?;
                let rows = stmt.query_map([&b.start_day, &b.end_day], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, u64>(1)?))
                })?;
                for row in rows {
                    let (bin, count) = row?;
                    if (0..5).contains(&bin) {
                        vals[bin as usize] += count;
                    }
                }
                if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
                    for (i, v) in cur.kb.gap.iter().enumerate() {
                        vals[i] += *v as u64;
                    }
                }
            }
            Ok(Histogram {
                dim: "gap".into(),
                items: ["<50", "50–100", "100–200", "200–500", ">500"]
                    .iter()
                    .enumerate()
                    .map(|(i, label)| HistItem {
                        label: label.to_string(),
                        value: vals[i],
                    })
                    .collect(),
            })
        }
        other => Err(anyhow!("非法直方图维度: {other}")),
    }
}

pub fn heatmap(db: &Db, range: Range, kind: &str, live: &LiveSnapshot) -> Result<Heatmap> {
    match kind {
        "week_hour" | "week" => {
            let b = if range == Range::Session {
                bounds(Range::Today)?
            } else {
                bounds(range)?
            };
            let conn = db.open_read()?;
            let mut vals = [[0f64; 24]; 7];
            let mut stmt =
                conn.prepare("SELECT ts,actions FROM agg_hour WHERE ts>=?1 AND ts<?2")?;
            let rows = stmt.query_map([b.start_ts, b.end_ts], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, u64>(1)?))
            })?;
            for row in rows {
                let (ts, actions) = row?;
                let wd = weekday_index(ts) as usize;
                let h = Local
                    .timestamp_opt(ts, 0)
                    .single()
                    .unwrap_or_else(now_local)
                    .hour() as usize;
                vals[wd][h] += actions as f64;
            }
            // 每个 weekday 在范围内出现的天数
            let mut days = [0f64; 7];
            if range != Range::Session {
                let today = now_local().date_naive();
                let back = match range {
                    Range::Today => 0,
                    Range::Week => 6,
                    Range::Month => 29,
                    Range::Session => 0,
                };
                let start = today - ChronoDuration::days(back);
                let mut d = start;
                while d <= today {
                    days[d.weekday().num_days_from_monday() as usize] += 1.0;
                    d += ChronoDuration::days(1);
                }
            } else {
                days = [1.0; 7];
            }
            if let Some(cur) = current_bucket(live) {
                let wd = weekday_index(cur.ts) as usize;
                let h = Local
                    .timestamp_opt(cur.ts, 0)
                    .single()
                    .unwrap_or_else(now_local)
                    .hour() as usize;
                vals[wd][h] += (cur.kb.keys() + cur.mouse.clicks()) as f64;
            }
            let mut cells = Vec::with_capacity(168);
            let mut max: f64 = 0.0;
            for y in 0..7 {
                for (x, raw) in vals[y].iter().enumerate() {
                    let v = if days[y] > 0.0 {
                        raw / (days[y] * 60.0)
                    } else {
                        0.0
                    };
                    max = max.max(v);
                    cells.push(HeatCell {
                        x: x as i64,
                        y: y as i64,
                        v,
                    });
                }
            }
            Ok(Heatmap {
                r#type: "week_hour".into(),
                cells,
                max,
            })
        }
        "calendar" | "cal" => {
            let conn = db.open_read()?;
            let today = now_local().date_naive();
            let start = today - ChronoDuration::days(370);
            let mut counts: BTreeMap<String, u64> = BTreeMap::new();
            let mut stmt =
                conn.prepare("SELECT day,actions FROM agg_day WHERE day>=?1 AND day<=?2")?;
            let rows = stmt.query_map(
                [
                    start.format("%Y-%m-%d").to_string(),
                    today.format("%Y-%m-%d").to_string(),
                ],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)),
            )?;
            for row in rows {
                let (day, actions) = row?;
                counts.insert(day, actions);
            }
            if let Some(cur) = current_bucket(live) {
                let d = Local
                    .timestamp_opt(cur.ts, 0)
                    .single()
                    .unwrap_or_else(now_local)
                    .format("%Y-%m-%d")
                    .to_string();
                *counts.entry(d).or_insert(0) += cur.kb.keys() + cur.mouse.clicks();
            }
            let offset = start.weekday().num_days_from_monday() as i64;
            let mut cells = Vec::with_capacity(371);
            let mut max: f64 = 0.0;
            for i in 0..371i64 {
                let d = start + ChronoDuration::days(i);
                let key = d.format("%Y-%m-%d").to_string();
                let v = counts.get(&key).copied().unwrap_or(0) as f64;
                max = max.max(v);
                cells.push(HeatCell {
                    x: (i + offset) / 7,
                    y: (i + offset) % 7,
                    v,
                });
            }
            Ok(Heatmap {
                r#type: "calendar".into(),
                cells,
                max,
            })
        }
        other => Err(anyhow!("非法热力图类型: {other}")),
    }
}

pub fn grid(db: &Db, range: Range, live: &LiveSnapshot) -> Result<Vec<GridCell>> {
    let mut out: BTreeMap<(i64, i64), u64> = BTreeMap::new();
    if range == Range::Session {
        for (x, y, v) in &live.grid {
            out.insert((*x as i64, *y as i64), *v as u64);
        }
    } else {
        let b = bounds(range)?;
        let conn = db.open_read()?;
        let mut stmt = conn.prepare(
            "SELECT x,y,SUM(count) FROM grid_day WHERE day BETWEEN ?1 AND ?2 GROUP BY x,y",
        )?;
        let rows = stmt.query_map([&b.start_day, &b.end_day], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, u64>(2)?,
            ))
        })?;
        for row in rows {
            let (x, y, v) = row?;
            out.insert((x, y), v);
        }
        if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
            for (k, v) in &cur.mouse.grid {
                if let Some((x, y)) = k.split_once(',')
                    && let (Ok(x), Ok(y)) = (x.parse::<i64>(), y.parse::<i64>())
                {
                    *out.entry((x, y)).or_insert(0) += *v as u64;
                }
            }
        }
    }
    Ok(out
        .into_iter()
        .map(|((x, y), v)| GridCell { x, y, v })
        .collect())
}

pub fn detail(db: &Db, range: Range, page: u32, live: &LiveSnapshot) -> Result<DetailPage> {
    let page_size = 50u32;
    let mut rows: Vec<DetailRow> = Vec::new();
    let b = bounds(range)?;
    if range == Range::Today {
        let conn = db.open_read()?;
        let mut stmt = conn.prepare(
            "SELECT (ts/60)*60 AS m,
                    SUM(CASE WHEN device='kb' THEN actions ELSE 0 END) AS keys,
                    SUM(CASE WHEN device='mouse' THEN actions ELSE 0 END) AS clicks
             FROM bucket WHERE ts>=?1 AND ts<?2 GROUP BY m",
        )?;
        let mut map: BTreeMap<i64, (u64, u64, f64)> = BTreeMap::new();
        let rws = stmt.query_map([b.start_ts, b.end_ts], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, u64>(1)?,
                r.get::<_, u64>(2)?,
            ))
        })?;
        for row in rws {
            let (m, keys, clicks) = row?;
            map.insert(m, (keys, clicks, 0.0));
        }
        // 移动距离只能从鼠标 payload 解
        let mut stmt = conn
            .prepare("SELECT ts,payload FROM bucket WHERE device='mouse' AND ts>=?1 AND ts<?2")?;
        let mrows = stmt.query_map([b.start_ts, b.end_ts], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?))
        })?;
        for row in mrows {
            let (ts, blob) = row?;
            let p: MousePayload = decode(&blob).unwrap_or_default();
            let m = (ts / 60) * 60;
            let e = map.entry(m).or_insert((0, 0, 0.0));
            e.2 += p.px;
        }
        if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
            let m = (cur.ts / 60) * 60;
            let e = map.entry(m).or_insert((0, 0, 0.0));
            e.0 += cur.kb.keys();
            e.1 += cur.mouse.clicks();
            e.2 += cur.mouse.px;
        }
        rows = map
            .into_iter()
            .filter(|(_, (keys, clicks, px))| keys + clicks > 0 || *px > 0.0)
            .map(|(ts, (keys, clicks, px))| DetailRow {
                ts: ts * 1000,
                label: Local
                    .timestamp_opt(ts, 0)
                    .single()
                    .unwrap_or_else(now_local)
                    .format("%H:%M")
                    .to_string(),
                actions: keys + clicks,
                keys,
                clicks,
                move_cm: px_to_cm(px),
            })
            .collect();
    } else if range == Range::Week {
        let conn = db.open_read()?;
        let mut stmt = conn.prepare(
            "SELECT ts,actions,keys,clicks,move_px FROM agg_hour WHERE ts>=?1 AND ts<?2",
        )?;
        let rws = stmt.query_map([b.start_ts, b.end_ts], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, u64>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, u64>(3)?,
                r.get::<_, f64>(4)?,
            ))
        })?;
        for row in rws {
            let (ts, actions, keys, clicks, px) = row?;
            if actions == 0 {
                continue;
            }
            rows.push(DetailRow {
                ts: ts * 1000,
                label: format!(
                    "{} {:02}:00",
                    weekday_label(ts),
                    Local
                        .timestamp_opt(ts, 0)
                        .single()
                        .unwrap_or_else(now_local)
                        .hour()
                ),
                actions,
                keys,
                clicks,
                move_cm: px_to_cm(px),
            });
        }
        if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
            let dt = Local
                .timestamp_opt(cur.ts, 0)
                .single()
                .unwrap_or_else(now_local);
            let hour = dt
                .date_naive()
                .and_hms_opt(dt.hour(), 0, 0)
                .and_then(|d| d.and_local_timezone(Local).single())
                .map(|d| d.timestamp())
                .unwrap_or(cur.ts);
            let label = format!(
                "{} {:02}:00",
                weekday_label(hour),
                Local
                    .timestamp_opt(hour, 0)
                    .single()
                    .unwrap_or_else(now_local)
                    .hour()
            );
            merge_row(
                &mut rows,
                hour,
                cur.kb.keys(),
                cur.mouse.clicks(),
                cur.mouse.px,
                &label,
            );
        }
    } else if range == Range::Month {
        let conn = db.open_read()?;
        let mut stmt = conn.prepare(
            "SELECT day,actions,keys,clicks,move_px FROM agg_day WHERE day BETWEEN ?1 AND ?2",
        )?;
        let rws = stmt.query_map([&b.start_day, &b.end_day], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u64>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, u64>(3)?,
                r.get::<_, f64>(4)?,
            ))
        })?;
        for row in rws {
            let (day, actions, keys, clicks, px) = row?;
            if actions == 0 {
                continue;
            }
            rows.push(DetailRow {
                ts: parse_day(&day) * 1000,
                label: Local
                    .timestamp_opt(parse_day(&day), 0)
                    .single()
                    .unwrap_or_else(now_local)
                    .format("%m/%d")
                    .to_string(),
                actions,
                keys,
                clicks,
                move_cm: px_to_cm(px),
            });
        }
        if let Some(cur) = current_bucket(live).filter(|c| in_range_current(c, &b)) {
            let day = Local
                .timestamp_opt(cur.ts, 0)
                .single()
                .unwrap_or_else(now_local)
                .date_naive();
            let ts = day_start(day);
            let label = Local
                .timestamp_opt(ts, 0)
                .single()
                .unwrap_or_else(now_local)
                .format("%m/%d")
                .to_string();
            merge_row(
                &mut rows,
                ts,
                cur.kb.keys(),
                cur.mouse.clicks(),
                cur.mouse.px,
                &label,
            );
        }
    }
    rows.sort_by_key(|b| std::cmp::Reverse(b.ts));
    let total = rows.len() as u64;
    let start = page as usize * page_size as usize;
    let page_rows = rows
        .into_iter()
        .skip(start)
        .take(page_size as usize)
        .collect();
    Ok(DetailPage {
        rows: page_rows,
        total,
        page,
        page_size,
        gran_label: match range {
            Range::Today => "每桶 60 秒".into(),
            Range::Week => "每桶 1 小时".into(),
            Range::Month => "每桶 1 天".into(),
            Range::Session => "本次会话".into(),
        },
    })
}

fn merge_row(rows: &mut Vec<DetailRow>, ts: i64, keys: u64, clicks: u64, px: f64, label: &str) {
    if let Some(row) = rows.iter_mut().find(|r| r.ts == ts * 1000) {
        row.keys += keys;
        row.clicks += clicks;
        row.actions += keys + clicks;
        row.move_cm += px_to_cm(px);
        return;
    }
    rows.push(DetailRow {
        ts: ts * 1000,
        label: label.to_string(),
        actions: keys + clicks,
        keys,
        clicks,
        move_cm: px_to_cm(px),
    });
}

fn parse_day(day: &str) -> i64 {
    NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .ok()
        .map(day_start)
        .unwrap_or_else(|| Local::now().timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::payload::{Device, KbPayload, MousePayload, PersistBucket, encode};
    use crate::storage::writer::apply_bucket;
    use std::path::PathBuf;

    fn temp_db(tag: &str) -> (Db, PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("hp-query-{tag}-{}-{nanos}.db", std::process::id()));
        let db = Db::open(&path).unwrap();
        (db, path)
    }

    fn cleanup(path: &PathBuf) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    fn kb_bucket(ts: i64, count: u32) -> PersistBucket {
        let mut p = KbPayload::default();
        p.k.insert(51, count);
        p.hold_sum.insert(51, count as u64 * 50);
        p.hold_max.insert(51, 60);
        p.first.insert(51, ts);
        p.last.insert(51, ts + 10);
        p.gap = [1, 2, 3, 4, 5];
        PersistBucket::new(ts, 60, Device::Kb, count as u64, encode(&p).unwrap())
    }

    fn mouse_bucket(ts: i64, clicks: u64) -> PersistBucket {
        let mut p = MousePayload::default();
        p.cl[0] = clicks;
        p.wh = [2, 1];
        p.px = 960.0;
        p.grid.insert("16,9".into(), clicks as u32);
        PersistBucket::new(ts, 60, Device::Mouse, clicks, encode(&p).unwrap())
    }

    fn live_current(ts: i64, keys: u32, clicks: u64) -> LiveSnapshot {
        let mut kb = KbPayload::default();
        if keys > 0 {
            kb.k.insert(51, keys);
            kb.first.insert(51, ts);
            kb.last.insert(51, ts);
        }
        let mut m = MousePayload::default();
        m.cl[0] = clicks;
        LiveSnapshot {
            current: Some(CurrentBucket {
                ts,
                granularity: 60,
                kb,
                mouse: m,
            }),
            ..Default::default()
        }
    }

    #[test]
    fn retention_purge_removes_old_rows() {
        let (db, p) = temp_db("purge");
        let now = Local::now().timestamp();
        let old = now - 40 * 86400;
        apply_bucket(&mut db.open_write().unwrap(), &kb_bucket(old, 2)).unwrap();
        let before = db
            .open_read()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM bucket", [], |r| r.get::<_, i64>(0))
            .unwrap();
        assert!(before > 0);
        let conn = db.open_write().unwrap();
        crate::storage::purge_tx(&conn, 30).unwrap();
        let after = db
            .open_read()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM bucket", [], |r| r.get::<_, i64>(0))
            .unwrap();
        assert_eq!(after, 0);
        cleanup(&p);
    }

    #[test]
    fn empty_db_all_zero() {
        let (db, p) = temp_db("empty");
        let live = LiveSnapshot::default();
        let s = summary(&db, Range::Today, &live).unwrap();
        assert_eq!((s.actions, s.keys, s.clicks), (0, 0, 0));
        assert_eq!(key_stats(&db, Range::Today, &live).unwrap().len(), 104);
        let d = detail(&db, Range::Today, 0, &live).unwrap();
        assert_eq!(d.total, 0);
        cleanup(&p);
    }

    #[test]
    fn summary_adds_current_bucket_once() {
        let (db, p) = temp_db("summary");
        let now = Local::now().timestamp();
        let ts = now - now.rem_euclid(60);
        apply_bucket(&mut db.open_write().unwrap(), &kb_bucket(ts - 60, 3)).unwrap();
        let live = live_current(ts, 2, 0);
        let s = summary(&db, Range::Today, &live).unwrap();
        assert_eq!(s.keys, 5);
        // 当前桶落盘后清空 current：仍为 5
        apply_bucket(&mut db.open_write().unwrap(), &kb_bucket(ts, 2)).unwrap();
        let empty_live = live_current(ts + 60, 0, 0);
        let s2 = summary(&db, Range::Today, &empty_live).unwrap();
        assert_eq!(s2.keys, 5);
        cleanup(&p);
    }

    #[test]
    fn key_stats_labels_and_holds() {
        let (db, p) = temp_db("keys");
        let now = Local::now().timestamp();
        let ts = now - now.rem_euclid(60);
        apply_bucket(&mut db.open_write().unwrap(), &kb_bucket(ts, 3)).unwrap();
        let stats = key_stats(&db, Range::Today, &LiveSnapshot::default()).unwrap();
        let a = stats.iter().find(|s| s.label == "A").unwrap();
        assert_eq!(a.count, 3);
        assert_eq!(a.hold_avg_ms, 50);
        assert_eq!(a.hold_max_ms, 60);
        assert!(a.ratio > 0.0);
        // 排序：按次数倒序
        assert_eq!(stats[0].key_id, 51);
        cleanup(&p);
    }

    #[test]
    fn mouse_stats_breakdown_and_wheel() {
        let (db, p) = temp_db("mouse");
        let now = Local::now().timestamp();
        let ts = now - now.rem_euclid(60);
        apply_bucket(&mut db.open_write().unwrap(), &mouse_bucket(ts, 4)).unwrap();
        let m = mouse_stats(&db, Range::Today, &LiveSnapshot::default()).unwrap();
        assert_eq!(m.clicks.left, 4);
        assert_eq!(m.clicks.total, 4);
        assert_eq!(m.wheel, [2, 1]);
        assert!((m.move_km - 0.0).abs() < 0.001); // 960px ≈ 0.00025km，四舍五入后可能为 0
        cleanup(&p);
    }

    #[test]
    fn detail_pagination_total() {
        let (db, p) = temp_db("detail");
        let now = Local::now().timestamp();
        let end = now - now.rem_euclid(60);
        let mut conn = db.open_write().unwrap();
        for i in 0..60i64 {
            apply_bucket(&mut conn, &kb_bucket(end - i * 60, 1)).unwrap();
        }
        let d0 = detail(&db, Range::Today, 0, &LiveSnapshot::default()).unwrap();
        assert_eq!(d0.total, 60);
        assert_eq!(d0.rows.len(), 50);
        let d1 = detail(&db, Range::Today, 1, &LiveSnapshot::default()).unwrap();
        assert_eq!(d1.rows.len(), 10);
        cleanup(&p);
    }

    #[test]
    fn settings_validation_and_clear() {
        let (db, p) = temp_db("settings");
        assert!(db.set_settings(60, 30).is_ok());
        assert!(db.set_settings(15, 30).is_err());
        assert!(db.set_settings(60, 15).is_err());
        let s = db.get_settings().unwrap();
        assert_eq!((s.bucket_seconds, s.retention_days), (60, 30));
        let now = Local::now().timestamp();
        let ts = now - now.rem_euclid(60);
        apply_bucket(&mut db.open_write().unwrap(), &kb_bucket(ts, 2)).unwrap();
        let mut conn = db.open_write().unwrap();
        crate::storage::writer::clear_conn(&mut conn).unwrap();
        let s2 = summary(&db, Range::Today, &LiveSnapshot::default()).unwrap();
        assert_eq!(s2.keys, 0);
        let keys: u32 = conn
            .query_row("SELECT COUNT(*) FROM key_def", [], |r| r.get(0))
            .unwrap();
        assert_eq!(keys, 104);
        cleanup(&p);
    }
}
