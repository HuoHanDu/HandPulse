import { invoke } from '@tauri-apps/api/core';
import { HP } from '../mock/mock';
import type {
  Bucket, DetailPage, DetailRowView, GridCell, Heatmap, HeatmapChart, HeatType,
  Histogram, HistogramChart, HistDim, KeyStat, KeyboardData, LineSeries, MouseData, RangeKey,
  StatsData, Summary
} from './types';

/**
 * IPC 客户端。
 *
 * M1：Rust 命令尚未实现，`IPC_READY = false`，浏览器与 Tauri 都走 mock；
 * M2：把 IPC_READY 置 true，Tauri 环境走 `invoke`，浏览器 dev 继续回退 mock。
 * 命令名与 `docs/02-原型需求报告.md` 6.2 对齐：get_summary / get_key_stats / get_buckets /
 * get_histogram / get_heatmap / get_grid / get_detail。
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const IPC_READY = false;

async function call<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: () => T): Promise<T> {
  if (!IPC_READY || !isTauri) return fallback();
  return invoke<T>(cmd, args);
}

/* ---------------- mock selectors ---------------- */

function sum(arr: number[]): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] || 0;
  return s;
}
function sliceSum(arr: number[], a: number, b: number): number {
  let s = 0;
  for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) s += arr[i] || 0;
  return s;
}
const NOW = HP.nowMinute;
const nf = (n: number) => HP.fmt.n(n);
const clk = (m: number) => HP.fmt.min(m);
function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}
function round(v: number): number {
  return Math.round(v);
}

function keyRange(range: RangeKey) {
  if (range === 'session') {
    const total = sliceSum(HP.perMinute.keys, NOW - 29, NOW);
    return { factor: total / HP.keyTotal, total, label: '本次' };
  }
  if (range === 'week') {
    const total = sum(HP.week.keys);
    return { factor: total / HP.keyTotal, total, label: '7 天' };
  }
  return { factor: 1, total: HP.keyTotal, label: '今日' };
}

function clickRange(range: RangeKey) {
  if (range === 'session') {
    const total = sliceSum(HP.perMinute.clicks, NOW - 29, NOW);
    return { factor: total / HP.clickTotal, total, label: '本次' };
  }
  if (range === 'week') {
    const total = sum(HP.week.clicks);
    return { factor: total / HP.clickTotal, total, label: '7 天' };
  }
  return { factor: 1, total: HP.clickTotal, label: '今日' };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

/** 键位首次/最近出现（分钟数），与原型同规则。 */
function keyTimes(label: string): [number, number] {
  if (label === 'A') return [9 * 60 + 12, 21 * 60 + 41];
  const h = hashStr(label);
  let first = 8 * 60 + 34 + (h % 46);
  const last = NOW - 2 - (Math.floor(h / 97) % 14);
  if (first > last - 30) first = Math.max(0, last - 30);
  return [first, last];
}

function keyIdOf(label: string): number {
  return HP.keyboard.keys.findIndex((k: { label: string }) => k.label === label);
}

const MOVE_GRID: GridCell[] = (() => {
  const map: Record<number, number> = {};
  HP.grid.forEach((g: GridCell) => { map[g.y * 32 + g.x] = g.v; });
  const total = sum(HP.moveHour);
  const out: GridCell[] = [];
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 32; x++) {
      let s = 0, w = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= 32 || ny >= 18) continue;
          const wgt = Math.exp(-(dx * dx + dy * dy) / 3.4);
          s += (map[ny * 32 + nx] || 0) * wgt;
          w += wgt;
        }
      }
      const v = s / (w || 1);
      if (v > 0.5) out.push({ x, y, v });
    }
  }
  const sv = sum(out.map(o => o.v)) || 1;
  out.forEach(o => { o.v = Math.round(o.v / sv * total); });
  return out;
})();

function statsSummary(range: RangeKey): string {
  if (range === 'week') {
    let best = { v: -1, wd: 0, h: 0 };
    HP.weekHeat.forEach((row: number[], wd: number) => {
      row.forEach((v, h) => { if (v > best.v) best = { v, wd, h }; });
    });
    return HP.week.labels[best.wd] + ' ' + pad2(best.h) + ' 时最忙，平均每分钟 ' + Math.round(best.v)
      + ' 次；当日总量 ' + nf(HP.week.totals[best.wd]) + ' 次。';
  }
  if (range === 'month') {
    let mx = HP.days30[0], tot = 0;
    HP.days30.forEach((d: { actions: number }) => { tot += d.actions; if (d.actions > mx.actions) mx = d; });
    return mx.date + ' 最高，' + nf(mx.actions) + ' 次；近 30 天日均 ' + nf(Math.round(tot / HP.days30.length)) + ' 次。';
  }
  let hv = -1, hmax = 0;
  HP.apmHour.forEach((v: number, h: number) => { if (v > hv) { hv = v; hmax = h; } });
  return hmax + ' 时最忙，平均每分钟 ' + Math.round(hv / 60) + ' 次；' + HP.peak.label + ' 单分钟峰值 ' + HP.peak.value + ' APM。';
}

/* ---------------- public IPC commands ---------------- */

export function getSummary(range: RangeKey): Promise<Summary> {
  return call('get_summary', { range }, () => {
    const kr = keyRange(range), cr = clickRange(range);
    return {
      actions: kr.total + cr.total,
      keys: kr.total,
      clicks: cr.total,
      moveKm: Math.round(HP.moveKm * cr.factor * 10) / 10
    };
  });
}

export function getKeyStats(range: RangeKey, _layout: number = 104): Promise<KeyStat[]> {
  return call('get_key_stats', { range, layout: _layout }, () => {
    const kr = keyRange(range);
    return HP.keyList.map((x: { label: string; count: number }) => {
      const count = round(HP.keyCounts[x.label] * kr.factor);
      const times = keyTimes(x.label);
      const isA = x.label === 'A';
      return {
        keyId: keyIdOf(x.label),
        label: x.label,
        count,
        ratio: kr.total ? count / kr.total : 0,
        holdAvgMs: isA ? HP.holds.keyAvg : HP.holds.avg,
        holdMaxMs: isA ? HP.holds.keyMaxHold : HP.holds.max,
        firstTs: times[0],
        lastTs: times[1]
      };
    });
  });
}

export function getBuckets(range: RangeKey): Promise<Bucket[]> {
  return call('get_buckets', { range }, () => {
    const dayStart = new Date(2026, 10, 4).getTime();
    const out: Bucket[] = [];
    if (range === 'week') {
      HP.weekHeat.forEach((row: number[], wd: number) => {
        row.forEach((v, h) => {
          const actions = round(v * 60);
          const keys = round(actions * (HP.week.keys[wd] / HP.week.totals[wd]));
          out.push({ ts: dayStart - (6 - wd) * 86400000 + h * 3600000, actions, keys, clicks: actions - keys, movePx: 0 });
        });
      });
      return out;
    }
    if (range === 'month') {
      HP.days30.forEach((d: { actions: number; keys: number; clicks: number }, i: number) => {
        out.push({ ts: dayStart - (29 - i) * 86400000, actions: d.actions, keys: d.keys, clicks: d.clicks, movePx: 0 });
      });
      return out;
    }
    for (let m = 0; m <= NOW; m++) {
      const keys = HP.perMinute.keys[m] || 0;
      const clicks = HP.perMinute.clicks[m] || 0;
      out.push({ ts: dayStart + m * 60000, actions: keys + clicks, keys, clicks, movePx: 0 });
    }
    return out;
  });
}

export function getHistogram(range: RangeKey, dim: 'key' | 'hour' | 'gap'): Promise<Histogram> {
  return call('get_histogram', { range, dim }, () => {
    if (dim === 'hour') {
      return { dim, items: HP.apmHour.map((v: number, i: number) => ({ label: pad2(i), value: v })) };
    }
    if (dim === 'gap') {
      return { dim, items: HP.histogram.gaps.map((g: { label: string; value: number }) => ({ label: g.label, value: g.value })) };
    }
    return { dim, items: HP.histogram.top20.map((t: { label: string; count: number }) => ({ label: t.label, value: t.count })) };
  });
}

export function getHeatmap(range: RangeKey, type: 'week_hour' | 'calendar'): Promise<Heatmap> {
  return call('get_heatmap', { range, type }, () => {
    if (type === 'calendar') {
      const firstWd = ((2 - 370) % 7 + 7) % 7;
      const cells = HP.calendar.map((d: { v: number }, i: number) => ({
        x: Math.floor((firstWd + i) / 7),
        y: (firstWd + i) % 7,
        v: d.v
      }));
      return { type, cells, max: HP.calendarMax };
    }
    const cells: Array<{ x: number; y: number; v: number }> = [];
    HP.weekHeat.forEach((row: number[], wd: number) => {
      row.forEach((v, h) => cells.push({ x: h, y: wd, v }));
    });
    return { type, cells, max: HP.weekHeatMax };
  });
}

export function getGrid(range: RangeKey): Promise<GridCell[]> {
  return call('get_grid', { range }, () => {
    const f = clickRange(range).factor;
    return HP.grid.map((g: GridCell) => ({ x: g.x, y: g.y, v: round(g.v * f) }));
  });
}

function detailRows(range: RangeKey): DetailRowView[] {
  const rows: DetailRowView[] = [];
  const dayStart = new Date(2026, 10, 4).getTime();
  if (range === 'week') {
    let totalAct = 0;
    HP.weekHeat.forEach((row: number[]) => { row.forEach((v) => { totalAct += round(v * 60); }); });
    const moveCm = HP.moveKm * 100000 * (sum(HP.week.totals) / HP.keyTotal);
    HP.weekHeat.forEach((row: number[], wd: number) => {
      const keyRatio = HP.week.keys[wd] / HP.week.totals[wd];
      row.forEach((v, h) => {
        const a = round(v * 60);
        const k = round(a * keyRatio);
        rows.push({
          ts: dayStart - (6 - wd) * 86400000 + h * 3600000,
          label: HP.week.labels[wd] + ' ' + pad2(h) + ':00',
          actions: a, keys: k, clicks: a - k,
          moveCm: round(moveCm * a / (totalAct || 1))
        });
      });
    });
    return rows.reverse();
  }
  if (range === 'month') {
    const totalClk = sum(HP.days30.map((d: { clicks: number }) => d.clicks));
    const mCm = HP.moveKm * 100000 * (sum(HP.days30.map((d: { actions: number }) => d.actions)) / HP.keyTotal);
    HP.days30.forEach((d: { date: string; actions: number; keys: number; clicks: number }, i: number) => {
      rows.push({
        ts: dayStart - (29 - i) * 86400000,
        label: d.date,
        actions: d.actions, keys: d.keys, clicks: d.clicks,
        moveCm: round(mCm * d.clicks / (totalClk || 1))
      });
    });
    return rows.reverse();
  }
  for (let m = NOW; m >= 0; m--) {
    const k = HP.perMinute.keys[m] || 0, c = HP.perMinute.clicks[m] || 0;
    rows.push({
      ts: dayStart + m * 60000,
      label: clk(m),
      actions: k + c, keys: k, clicks: c,
      moveCm: round(HP.moveKm * 100000 * c / HP.clickTotal)
    });
  }
  return rows;
}

export function getDetail(range: RangeKey, page: number, pageSize = 50): Promise<DetailRowView[]> {
  return call('get_detail', { range, page }, () => {
    const all = detailRows(range);
    return all.slice(page * pageSize, page * pageSize + pageSize);
  });
}

/* ---------------- page loaders（页面只依赖这些 + IPC 命令） ---------------- */

export async function loadKeyboard(range: RangeKey): Promise<KeyboardData> {
  const [summary, keyStats] = await Promise.all([getSummary(range), getKeyStats(range)]);
  return { summary, keyStats, rangeLabel: keyRange(range).label, total: keyRange(range).total };
}

export async function loadMouse(range: RangeKey): Promise<MouseData> {
  const summary = await getSummary(range);
  const cr = clickRange(range);
  return {
    summary,
    rangeLabel: cr.label,
    factor: cr.factor,
    grid: HP.grid,
    moveGrid: MOVE_GRID,
    gridMax: HP.gridMax,
    extra: {
      clicks: HP.clicks,
      wheel: [HP.wheel.up, HP.wheel.down],
      peakSpeed: HP.peakSpeed,
      moveKm: HP.moveKm
    }
  };
}

export function getLineSeries(range: RangeKey): Promise<LineSeries> {
  return call('get_buckets', { range, view: 'line' }, () => {
    if (range === 'week') {
      const vals: number[] = [];
      HP.weekHeat.forEach((row: number[]) => row.forEach((v) => vals.push(round(v * 60))));
      const max = Math.max(...vals);
      const pi = vals.indexOf(max);
      const wd = Math.floor(pi / 24), hr = pi % 24;
      return {
        values: vals, unit: '次/时', xMode: 'index', xMax: vals.length,
        xTicks: HP.week.labels.map((l: string, i: number) => ({ label: l, pos: (i * 24 + 12) / 168 })),
        peak: { idx: pi, val: max },
        peakText: '峰值 ' + nf(max) + ' 次/时，' + HP.week.labels[wd] + ' ' + pad2(hr) + ' 时',
        tip: (i: number) => HP.week.labels[Math.floor(i / 24)] + ' ' + pad2(i % 24) + ':00，' + nf(vals[i]) + ' 次/时',
        note: statsSummary(range),
        aria: '近 7 天每小时动作数折线图，峰值 ' + nf(max) + ' 次每小时'
      };
    }
    if (range === 'month') {
      const v30 = HP.days30.map((d: { actions: number }) => d.actions);
      const m30 = Math.max(...v30);
      const p30 = v30.indexOf(m30);
      return {
        values: v30, unit: '次/天', xMode: 'index', xMax: v30.length,
        xTicks: HP.days30.map((d: { date: string }, i: number) => i % 5 === 0 ? { label: d.date, pos: i / (v30.length - 1) } : null).filter(Boolean) as Array<{ label: string; pos: number }>,
        peak: { idx: p30, val: m30 },
        peakText: '峰值 ' + nf(m30) + ' 次，' + HP.days30[p30].date,
        tip: (i: number) => HP.days30[i].date + '，' + nf(v30[i]) + ' 次',
        note: statsSummary(range),
        aria: '近 30 天每日动作数折线图，峰值 ' + nf(m30) + ' 次'
      };
    }
    const tv: number[] = [];
    for (let m = 0; m <= NOW; m++) tv.push((HP.perMinute.keys[m] || 0) + (HP.perMinute.clicks[m] || 0));
    return {
      values: tv, unit: '次/分', xMode: 'time', xMax: 1440,
      xTicks: [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => ({ label: h === 24 ? '24' : pad2(h), pos: h / 24 })),
      peak: { idx: HP.peak.minute, val: HP.peak.value },
      peakText: '峰值 ' + HP.peak.value + ' APM，' + HP.peak.label,
      tip: (i: number) => clk(i) + '，' + nf(tv[i]) + ' 次/分',
      note: statsSummary(range),
      aria: '今日每分钟动作数折线图，21:03 达到峰值 380 次每分钟'
    };
  });
}

export function getHistogramChart(range: RangeKey, dim: HistDim): Promise<HistogramChart> {
  return call('get_histogram', { range, dim }, () => {
    if (dim === 'hours') {
      const items = HP.apmHour.map((v: number, i: number) => ({ label: pad2(i), value: v }));
      return {
        dim, items, log: false, max: Math.max(...items.map((i: { value: number }) => i.value)),
        readout: '20 时，' + nf(HP.apmHour[20]) + ' 次',
        aria: '24 小时动作分布柱状图'
      };
    }
    if (dim === 'gaps') {
      const items = HP.histogram.gaps.map((g: { label: string; value: number }) => ({ label: g.label, value: g.value }));
      return {
        dim, items, log: true, max: Math.max(...items.map((i: { value: number }) => i.value)),
        readout: '50–100 ms 最多，' + nf(HP.histogram.gaps[1].value) + ' 次',
        aria: '按键间隔分布（对数轴）'
      };
    }
    const items = HP.histogram.top20.map((t: { label: string; count: number }) => ({ label: t.label, value: t.count }));
    return {
      dim, items, log: false, max: items[0].value,
      readout: 'W 最高，' + nf(items[0].value) + ' 次',
      aria: '按键次数 Top 20 横向条形图，W 最高 1,204 次'
    };
  });
}

export function getHeatmapChart(range: RangeKey, type: HeatType): Promise<HeatmapChart> {
  return call('get_heatmap', { range, type }, () => {
    if (type === 'cal') {
      const firstWd = ((2 - 370) % 7 + 7) % 7;
      const cells = HP.calendar.map((d: { v: number; iso: string }, i: number) => ({
        x: Math.floor((firstWd + i) / 7), y: (firstWd + i) % 7, v: d.v, iso: d.iso
      }));
      const months: Array<{ label: string; col: number }> = [];
      const seen: Record<number, number> = {};
      HP.calendar.forEach((_d: unknown, i: number) => {
        const col = Math.floor((firstWd + i) / 7);
        if (col >= 54) return;
        const dt = new Date(2025, 9, 30);
        dt.setDate(dt.getDate() + i);
        if (dt.getDate() === 1 && seen[dt.getMonth() + 1] === undefined) {
          seen[dt.getMonth() + 1] = col;
          months.push({ label: (dt.getMonth() + 1) + ' 月', col });
        }
      });
      const mx30 = HP.days30.reduce((a: { actions: number }, b: { actions: number }) => b.actions > a.actions ? b : a);
      return {
        type: 'cal', cells, max: HP.calendarMax,
        readout: '11/04，' + nf(HP.calendar[HP.calendar.length - 1].v) + ' 次',
        aria: '日历热力，今日描边高亮',
        months,
        footnote: '近 ' + HP.calendar.length + ' 天，最高 ' + mx30.date + ' ' + nf(mx30.actions) + ' 次；蓝框为今日 11/04。',
        legendMin: '少', legendMax: nf(HP.calendarMax) + ' 次/天',
        todayLabel: '11/04'
      };
    }
    const cells: Array<{ x: number; y: number; v: number }> = [];
    HP.weekHeat.forEach((row: number[], wd: number) => {
      row.forEach((v, h) => cells.push({ x: h, y: wd, v }));
    });
    return {
      type: 'week', cells, max: HP.weekHeatMax,
      readout: '周三 20 时，' + HP.weekHeat[2][20].toFixed(1) + ' 次/分',
      aria: '7 乘 24 小时平均动作热力图，周三 20 时最深',
      weekLabels: HP.week.labels,
      legendMin: '0', legendMax: HP.weekHeatMax.toFixed(1) + ' 次/分'
    };
  });
}

export async function loadStats(range: RangeKey): Promise<StatsData> {
  const [summary, line, top20, hours, gaps, week, cal] = await Promise.all([
    getSummary(range),
    getLineSeries(range),
    getHistogramChart(range, 'top20'),
    getHistogramChart(range, 'hours'),
    getHistogramChart(range, 'gaps'),
    getHeatmapChart(range, 'week'),
    getHeatmapChart(range, 'cal')
  ]);
  return {
    summary, line,
    histograms: { top20, hours, gaps },
    heatmaps: { week, cal }
  };
}

export async function getDetailPage(range: RangeKey, page: number): Promise<DetailPage> {
  const [rows, all] = await Promise.all([getDetail(range, page), detailRows(range)]);
  return {
    rows,
    total: all.length,
    page,
    pageSize: 50,
    granLabel: range === 'week' ? '每桶 1 小时' : range === 'month' ? '每桶 1 天' : '每桶 60 秒'
  };
}
