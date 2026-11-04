/**
 * IPC 数据契约。
 *
 * 这些类型是前端与 Rust 采集内核之间的边界：M2 接入真实命令后，字段名与含义保持不变。
 * 命名统一 camelCase；时间戳 ts 为本地时间的 epoch 毫秒。
 */

export type RangeKey = 'session' | 'today' | 'week' | 'month';

export interface Summary {
  actions: number;
  keys: number;
  clicks: number;
  moveKm: number;
}

export interface KeyStat {
  keyId: number;
  label: string;
  count: number;
  ratio: number;
  holdAvgMs: number;
  holdMaxMs: number;
  firstTs: number;
  lastTs: number;
}

export interface Bucket {
  ts: number;
  actions: number;
  keys: number;
  clicks: number;
  movePx: number;
}

export interface Histogram {
  dim: 'key' | 'hour' | 'gap';
  items: Array<{ label: string; value: number }>;
}

export interface Heatmap {
  type: 'week_hour' | 'calendar';
  cells: Array<{ x: number; y: number; v: number }>;
  max: number;
}

export interface DetailRow {
  ts: number;
  actions: number;
  keys: number;
  clicks: number;
  moveCm: number;
}

/**
 * 实时帧。M2 通过 `tauri::ipc::Channel` 推送，seq 单调递增用于去重/丢弃晚到帧。
 * keys 为 [keyId, delta]，keyId 与 KeyStat.keyId 一致。
 */
export interface LiveFrame {
  seq: number;
  ts: number;
  keys: Array<[number, number]>;
  clicks: [number, number, number, number, number];
  wheel: [number, number];
  dx: number;
  dy: number;
  grid: Array<[number, number]>;
}

/* ------------------------------------------------------------------ */
/* 页面视图模型：M1 由 mock 派生；M2 后可以换成 Rust 返回的同构结构。      */
/* ------------------------------------------------------------------ */

export interface ClickBreakdown {
  left: number;
  right: number;
  middle: number;
  side1: number;
  side2: number;
  total: number;
}

export interface GridCell {
  x: number;
  y: number;
  v: number;
}

export interface MouseExtra {
  clicks: ClickBreakdown;
  wheel: [number, number];
  peakSpeed: number;
  moveKm: number;
}

export interface KeyboardData {
  summary: Summary;
  keyStats: KeyStat[];
  rangeLabel: string;
  total: number;
}

export interface MouseData {
  summary: Summary;
  rangeLabel: string;
  factor: number;
  grid: GridCell[];
  moveGrid: GridCell[];
  gridMax: number;
  extra: MouseExtra;
}

export interface LineSeries {
  unit: string;
  values: number[];
  xMode: 'time' | 'index';
  xMax: number;
  xTicks: Array<{ label: string; pos: number }>;
  peak: { idx: number; val: number };
  peakText: string;
  note: string;
  aria: string;
  tip: (i: number) => string;
}

export type HistDim = 'top20' | 'hours' | 'gaps';

export interface HistogramChart {
  dim: HistDim;
  items: Array<{ label: string; value: number }>;
  log: boolean;
  max: number;
  readout: string;
  aria: string;
}

export type HeatType = 'week' | 'cal';

export interface HeatmapChart {
  type: HeatType;
  cells: Array<{ x: number; y: number; v: number; iso?: string }>;
  max: number;
  readout: string;
  aria: string;
  weekLabels?: string[];
  months?: Array<{ label: string; col: number }>;
  footnote?: string;
  legendMin?: string;
  legendMax?: string;
  todayLabel?: string;
}

export interface StatsData {
  summary: Summary;
  line: LineSeries;
  histograms: Record<HistDim, HistogramChart>;
  heatmaps: Record<HeatType, HeatmapChart>;
}

export interface DetailRowView extends DetailRow {
  label: string;
}

export interface DetailPage {
  rows: DetailRowView[];
  total: number;
  page: number;
  pageSize: number;
  granLabel: string;
}
