import {
  getBuckets, getGrid, getKeyStats, getMouseStats, getPadStats, getSummary, loadAppStats, loadPatterns
} from '../ipc/client';
import type {
  AppStat, Bucket, GridCell, KeyStat, MouseStats, PadStats, PatternStats, RangeKey, Summary
} from '../ipc/types';

export type ShareRange = 'today' | 'week' | 'month';

export interface ShareDay {
  label: string;
  actions: number;
}

export interface ShareCardData {
  range: ShareRange;
  rangeLabel: string;
  summary: Summary;
  keys: KeyStat[];
  patterns: PatternStats;
  mouse: MouseStats;
  grid: GridCell[];
  apps: AppStat[];
  pad: PadStats;
  days: ShareDay[];
}

export const SHARE_RANGE_OPTIONS: Array<[ShareRange, string]> = [
  ['today', '今日'],
  ['week', '近 7 天'],
  ['month', '近 30 天']
];

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function rangeLabel(range: ShareRange): string {
  return range === 'week' ? '近 7 天' : range === 'month' ? '近 30 天' : '今日';
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function buildWeekDays(buckets: Bucket[]): ShareDay[] {
  const totals = new Map<string, number>();
  for (const b of buckets) {
    totals.set(dayKey(b.ts), (totals.get(dayKey(b.ts)) || 0) + b.actions);
  }
  const out: ShareDay[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push({
      label: WEEK_LABELS[d.getDay()],
      actions: totals.get(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`) || 0
    });
  }
  return out;
}

export async function loadShareCard(range: ShareRange, includeApps: boolean): Promise<ShareCardData> {
  const [summary, keys, patterns, mouse, grid, apps, pad, buckets] = await Promise.all([
    getSummary(range as RangeKey),
    getKeyStats(range as RangeKey),
    loadPatterns(range as RangeKey),
    getMouseStats(range as RangeKey),
    getGrid(range as RangeKey),
    includeApps ? loadAppStats(range as RangeKey) : Promise.resolve<AppStat[]>([]),
    getPadStats(range as RangeKey),
    getBuckets(range as RangeKey)
  ]);

  return {
    range,
    rangeLabel: rangeLabel(range),
    summary,
    keys: keys.slice().sort((a, b) => b.count - a.count),
    patterns,
    mouse,
    grid,
    apps: apps.slice().sort((a, b) => b.seconds - a.seconds).slice(0, 3),
    pad: {
      total: pad.total,
      buttons: pad.buttons.slice().sort((a, b) => b.count - a.count).slice(0, 8)
    },
    days: range === 'week' ? buildWeekDays(buckets) : []
  };
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function formatKm(km: number): string {
  return km >= 10 ? km.toFixed(1) : km.toFixed(2);
}
