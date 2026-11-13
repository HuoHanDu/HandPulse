import { invoke } from '@tauri-apps/api/core';
import { HP } from '../mock/mock';
import type {
  Bucket, DetailPage, DetailRowView, GridCell, Heatmap, HeatmapChart, HeatType,
  Histogram, HistogramChart, HistDim, KeyStat, KeyboardData, LineSeries, MouseData,
  MouseStats, PadStats, PatternStats, RangeKey, Settings, StatsData, Summary
} from './types';

/**
 * IPC 客户端。
 *
 * - Tauri：全部命令走 `invoke`，历史数据来自 SQLite；
 * - 浏览器 dev：回退到 mock，方便不启动 Rust 时看四页视觉。
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: () => T): Promise<T> {
  if (!isTauri) return fallback();
  return invoke<T>(cmd, args);
}

/* ---------------- mock selectors（仅浏览器 dev / 无 Tauri 环境） ---------------- */

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

/* ---------------- 命令 ---------------- */

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

export function getKeyStats(range: RangeKey, layout: number = 104): Promise<KeyStat[]> {
  return call('get_key_stats', { range, layout }, () => {
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

export function getMouseStats(range: RangeKey): Promise<MouseStats> {
  return call('get_mouse_stats', { range }, () => {
    const cr = clickRange(range);
    const f = cr.factor;
    return {
      clicks: {
        left: round(HP.clicks.left * f), right: round(HP.clicks.right * f),
        middle: round(HP.clicks.middle * f), side1: round(HP.clicks.side1 * f),
        side2: round(HP.clicks.side2 * f), total: cr.total
      },
      wheel: [round(HP.wheel.up * f), round(HP.wheel.down * f)],
      peakSpeed: HP.peakSpeed,
      moveKm: Math.round(HP.moveKm * f * 10) / 10
    };
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

export function getMoveGrid(range: RangeKey): Promise<GridCell[]> {
  return call('get_move_grid', { range }, () => {
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

/* ---------------- 页面 loaders ---------------- */

export async function loadPatterns(range: RangeKey): Promise<PatternStats> {
  if (isTauri) return invoke<PatternStats>('get_patterns', { range });
  return { pairs: [], total: 0, adFast: 0, adTotal: 0, gapHist: [0, 0, 0, 0, 0, 0, 0] };
}

export async function loadKeyboard(range: RangeKey): Promise<KeyboardData> {
  const [summary, keyStats] = await Promise.all([getSummary(range), getKeyStats(range)]);
  const label = isTauri
    ? (range === 'session' ? '本次' : range === 'week' ? '7 天' : '今日')
    : keyRange(range).label;
  return { summary, keyStats, rangeLabel: label, total: summary.keys };
}

export async function loadMouse(range: RangeKey): Promise<MouseData> {
  const [summary, extra, grid, moveGrid] = await Promise.all([
    getSummary(range), getMouseStats(range), getGrid(range), getMoveGrid(range)
  ]);
  const label = range === 'session' ? '本次' : range === 'week' ? '7 天' : '今日';
  const gridMax = grid.reduce((m, g) => Math.max(m, g.v), 0);
  return {
    summary,
    rangeLabel: label,
    factor: 1,
    grid,
    moveGrid,
    gridMax,
    extra
  };
}

/* ---------------- 图表派生 ---------------- */

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MONTH_SHORT = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export async function getLineSeries(range: RangeKey): Promise<LineSeries> {
  if (isTauri) return realLineSeries(range);
  return mockLineSeries(range);
}

function mockLineSeries(range: RangeKey): Promise<LineSeries> {
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

async function realLineSeries(range: RangeKey): Promise<LineSeries> {
  const raw = await getBuckets(range);
  const now = new Date();
  const maxOf = (vals: number[]) => {
    let idx = 0, val = 0;
    vals.forEach((v, i) => { if (v > val) { val = v; idx = i; } });
    return { idx, val };
  };
  if (range === 'week') {
    const start = startOfLocalDay(new Date(now.getTime() - 6 * 86400000));
    const dayLabels = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return WEEK_LABELS[(d.getDay() + 6) % 7];
    });
    const vals = new Array(7 * 24).fill(0);
    raw.forEach(b => {
      const d = new Date(b.ts);
      const idx = Math.floor((startOfLocalDay(d) - start) / 86400000) * 24 + d.getHours();
      if (idx >= 0 && idx < vals.length) vals[idx] += b.actions;
    });
    const pk = maxOf(vals);
    const wd = Math.floor(pk.idx / 24), hr = pk.idx % 24;
    return {
      values: vals, unit: '次/时', xMode: 'index', xMax: vals.length,
      xTicks: dayLabels.map((l, i) => ({ label: l, pos: (i * 24 + 12) / 168 })),
      peak: pk,
      peakText: '峰值 ' + nf(pk.val) + ' 次/时，' + dayLabels[wd] + ' ' + pad2(hr) + ' 时',
      tip: (i) => dayLabels[Math.floor(i / 24)] + ' ' + pad2(i % 24) + ':00，' + nf(vals[i]) + ' 次/时',
      note: peakNote('week', pk.val, dayLabels[wd] + ' ' + pad2(hr) + ':00'),
      aria: '近 7 天每小时动作数折线图'
    };
  }
  if (range === 'month') {
    const start = startOfLocalDay(new Date(now.getTime() - 29 * 86400000));
    const vals = new Array(30).fill(0);
    const labels = new Array(30).fill('');
    raw.forEach(b => {
      const d = new Date(b.ts);
      const idx = Math.round((startOfLocalDay(d) - start) / 86400000);
      if (idx >= 0 && idx < 30) vals[idx] += b.actions;
    });
    for (let i = 0; i < 30; i++) {
      const d = new Date(start + i * 86400000);
      labels[i] = (d.getMonth() + 1) + '/' + d.getDate();
    }
    const pk = maxOf(vals);
    return {
      values: vals, unit: '次/天', xMode: 'index', xMax: vals.length,
      xTicks: labels.map((l, i) => i % 5 === 0 ? { label: l, pos: i / 29 } : null).filter(Boolean) as Array<{ label: string; pos: number }>,
      peak: pk,
      peakText: '峰值 ' + nf(pk.val) + ' 次，' + labels[pk.idx],
      tip: (i) => labels[i] + '，' + nf(vals[i]) + ' 次',
      note: peakNote('month', pk.val, labels[pk.idx]),
      aria: '近 30 天每日动作数折线图'
    };
  }
  // today
  const start = startOfLocalDay(now);
  const nowMin = Math.floor((now.getTime() - start) / 60000);
  const vals = new Array(nowMin + 1).fill(0);
  raw.forEach(b => {
    const m = Math.floor((b.ts - start) / 60000);
    if (m >= 0 && m < vals.length) vals[m] += b.actions;
  });
  const pk = maxOf(vals);
  const peakTime = clk(pk.idx);
  return {
    values: vals, unit: '次/分', xMode: 'time', xMax: 1440,
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => ({ label: h === 24 ? '24' : pad2(h), pos: h / 24 })),
    peak: pk,
    peakText: '峰值 ' + pk.val + ' APM，' + peakTime,
    tip: (i) => clk(i) + '，' + nf(vals[i]) + ' 次/分',
    note: peakNote('today', pk.val, peakTime),
    aria: '今日每分钟动作数折线图'
  };
}

function peakNote(range: RangeKey, peak: number, at: string): string {
  const unit = range === 'week' ? '次/时' : range === 'month' ? '次/天' : '次/分';
  return '峰值 ' + nf(peak) + ' ' + unit + '，出现在 ' + at + '。';
}

export async function getHistogramChart(range: RangeKey, dim: HistDim): Promise<HistogramChart> {
  if (!isTauri) return mockHistogramChart(range, dim);
  const rustDim = dim === 'top20' ? 'key' : dim === 'hours' ? 'hour' : 'gap';
  const raw = await getHistogram(range, rustDim as 'key' | 'hour' | 'gap');
  const items = raw.items;
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);
  const top = items.slice().sort((a, b) => b.value - a.value)[0];
  return {
    dim, items, log: dim === 'gaps', max,
    readout: top ? top.label + '，' + nf(top.value) + ' 次' : '无记录',
    aria: dim === 'gaps' ? '按键间隔分布（对数轴）' : dim === 'hours' ? '24 小时动作分布柱状图' : '按键次数 Top 20 横向条形图'
  };
}

function mockHistogramChart(range: RangeKey, dim: HistDim): Promise<HistogramChart> {
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

function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

function monthChartFromCalendar(cal: HeatmapChart): HeatmapChart {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const prefix = year + '-' + (month < 10 ? '0' : '') + month + '-';
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells = cal.cells
    .filter((c) => c.iso?.startsWith(prefix))
    .map((c) => {
      const day = Number(c.iso!.slice(8, 10));
      return { ...c, x: Math.floor((day - 1 + offset) / 7), y: (offset + day - 1) % 7 };
    });
  const max = cells.reduce((m, c) => Math.max(m, c.v), 0);
  const peak = cells.reduce((a, b) => (b.v > a.v ? b : a), cells[0] ?? { x: 0, y: 0, v: 0, iso: '' });
  return {
    type: 'month',
    cells,
    max,
    readout: peak.iso ? peak.iso + '，' + nf(peak.v) + ' 次' : '本月暂无记录',
    aria: year + ' 年 ' + month + ' 月日历热力图',
    footnote: year + ' 年 ' + month + ' 月，最高 ' + nf(max) + ' 次/天',
    legendMin: '少',
    legendMax: nf(max) + ' 次/天'
  };
}

export async function getHeatmapChart(range: RangeKey, type: HeatType): Promise<HeatmapChart> {
  if (!isTauri) return mockHeatmapChart(range, type);
  if (type === 'month') {
    return monthChartFromCalendar(await getHeatmapChart(range, 'cal'));
  }
  const rawType = type === 'week' ? 'week_hour' : 'calendar';
  const raw = await getHeatmap(range, rawType);
  if (type === 'cal') {
    const today = new Date();
    const start = new Date(startOfLocalDay(today) - 370 * 86400000);
    const cells = raw.cells.map(c => {
      const d = new Date(start.getTime() + ((c.x * 7 + c.y - mondayIndex(start)) * 86400000));
      return { ...c, iso: localIsoDate(d) };
    });
    const months: Array<{ label: string; col: number }> = [];
    const seen = new Set<number>();
    for (let i = 0; i < 371; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const col = Math.floor((i + mondayIndex(start)) / 7);
      if (d.getDate() === 1 && !seen.has(d.getMonth())) {
        seen.add(d.getMonth());
        months.push({ label: MONTH_SHORT[d.getMonth()], col });
      }
    }
    const todayKey = localIsoDate(today);
    const todayCell = cells.find(c => c.iso === todayKey);
    return {
      type: 'cal', cells, max: raw.max,
      readout: todayCell ? todayKey + '，' + nf(todayCell.v) + ' 次' : '今天，0 次',
      aria: '日历热力，今日描边高亮',
      months,
      footnote: '近 371 天，最高 ' + nf(raw.max) + ' 次/天；蓝框为今日。',
      legendMin: '少',
      legendMax: nf(raw.max) + ' 次/天',
      todayLabel: (today.getMonth() + 1) + '/' + today.getDate() + ' ' + today.toLocaleDateString('en-US')
    };
  }
  const peak = raw.cells.reduce((a, b) => b.v > a.v ? b : a, raw.cells[0] ?? { x: 0, y: 0, v: 0 });
  return {
    type: 'week', cells: raw.cells, max: raw.max,
    readout: WEEK_LABELS[peak.y] + ' ' + pad2(peak.x) + ' 时，' + peak.v.toFixed(1) + ' 次/分',
    aria: '7 乘 24 小时平均动作热力图',
    weekLabels: WEEK_LABELS,
    legendMin: '0',
    legendMax: raw.max.toFixed(1) + ' 次/分'
  };
}

function mockHeatmapChart(range: RangeKey, type: HeatType): Promise<HeatmapChart> {
  if (type === 'month') {
    return mockHeatmapChart(range, 'cal').then(monthChartFromCalendar);
  }
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
      return {
        type: 'cal', cells, max: HP.calendarMax,
        readout: '11/04，' + nf(HP.calendar[HP.calendar.length - 1].v) + ' 次',
        aria: '日历热力，今日描边高亮',
        months,
        footnote: '近 ' + HP.calendar.length + ' 天，最高 ' + HP.calendarMax + ' 次/天；蓝框为今日 11/04。',
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
  const [summary, line, top20, hours, gaps, week, cal, month] = await Promise.all([
    getSummary(range),
    getLineSeries(range),
    getHistogramChart(range, 'top20'),
    getHistogramChart(range, 'hours'),
    getHistogramChart(range, 'gaps'),
    getHeatmapChart(range, 'week'),
    getHeatmapChart(range, 'cal'),
    getHeatmapChart(range, 'month')
  ]);
  return {
    summary, line,
    histograms: { top20, hours, gaps },
    heatmaps: { week, cal, month }
  };
}

export async function getDetailPage(range: RangeKey, page: number): Promise<DetailPage> {
  if (isTauri) {
    return invoke<DetailPage>('get_detail', { range, page });
  }
  const rows = await getDetail(range, page);
  const all = detailRows(range);
  return {
    rows,
    total: all.length,
    page,
    pageSize: 50,
    granLabel: range === 'week' ? '每桶 1 小时' : range === 'month' ? '每桶 1 天' : '每桶 60 秒'
  };
}

export async function getCustomDetail(startTs: number, endTs: number, page: number): Promise<DetailPage> {
  if (isTauri) {
    return invoke<DetailPage>('get_custom_detail', { startTs, endTs, page });
  }
  // 浏览器 mock 没有自定义 SQL，退回今日明细以便继续看视觉。
  return getDetailPage('today', page);
}

export async function getCustomKeyStats(startTs: number, endTs: number): Promise<KeyStat[]> {
  if (isTauri) return invoke<KeyStat[]>('get_custom_key_stats', { startTs, endTs });
  return [];
}

export async function getCustomMouseStats(startTs: number, endTs: number): Promise<MouseStats> {
  if (isTauri) return invoke<MouseStats>('get_custom_mouse_stats', { startTs, endTs });
  return { clicks: { left: 0, right: 0, middle: 0, side1: 0, side2: 0, total: 0 }, wheel: [0, 0], peakSpeed: 0, moveKm: 0 };
}

export async function getCustomPadStats(startTs: number, endTs: number): Promise<PadStats> {
  if (isTauri) return invoke<PadStats>('get_custom_pad_stats', { startTs, endTs });
  return { total: 0, buttons: [] };
}

/* ---------------- 设置 / 维护 ---------------- */

export function getDataVersion(): Promise<number> {
  return call('get_data_version', undefined, () => 1);
}

export function getSettings(): Promise<Settings> {
  return call('get_settings', undefined, () => ({
    bucketSeconds: 60,
    retentionDays: 30,
    dbPath: '%APPDATA%\\com.handpulse.desktop\\data.db',
    schemaVersion: 1,
    dataVersion: 1
  }));
}

export function openDataDir(): Promise<void> {
  return call('open_data_dir', undefined, () => undefined);
}

export function setSettings(bucketSeconds: number, retentionDays: number): Promise<Settings> {
  return call('set_settings', { bucketSeconds, retentionDays }, () => ({
    bucketSeconds,
    retentionDays,
    dbPath: '%APPDATA%\\com.handpulse.desktop\\data.db',
    schemaVersion: 1,
    dataVersion: 1
  }));
}

export function clearAllData(): Promise<void> {
  return call('clear_all_data', undefined, () => undefined);
}
