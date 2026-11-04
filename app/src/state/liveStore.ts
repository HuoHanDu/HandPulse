import type { LiveFrame } from '../ipc/types';

export interface LiveDeltas {
  seq: number;
  ts: number;
  keys: Map<number, number>;
  clicks: [number, number, number, number, number];
  wheel: [number, number];
  dx: number;
  dy: number;
  grid: Array<[number, number]>;
}

function emptyClicks(): [number, number, number, number, number] {
  return [0, 0, 0, 0, 0];
}

/**
 * 实时增量 store。
 *
 * - 收到的帧按 seq 去重，晚到的旧帧直接丢弃；
 * - 增量先累加，requestAnimationFrame 时合并成一批通知订阅者（10Hz → 每帧最多一次）；
 * - 页面不可见（document.hidden）时不 flush，恢复可见后补一次；
 * - 键盘/鼠标组件只消费本批 delta，不触发 React 全树重渲染。
 */
class LiveStore {
  private lastSeq = -1;
  private pendingKeys = new Map<number, number>();
  private pendingClicks = emptyClicks();
  private pendingWheel: [number, number] = [0, 0];
  private pendingDx = 0;
  private pendingDy = 0;
  private pendingGrid: Array<[number, number]> = [];

  private published: LiveDeltas = {
    seq: -1, ts: 0, keys: new Map(), clicks: emptyClicks(), wheel: [0, 0], dx: 0, dy: 0, grid: []
  };

  private listeners = new Set<() => void>();
  private raf = 0;
  private pendingWhenVisible = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.pendingWhenVisible) {
          this.pendingWhenVisible = false;
          this.schedule();
        }
      });
    }
  }

  push(frame: LiveFrame): void {
    if (frame.seq <= this.lastSeq) return;
    this.lastSeq = frame.seq;
    for (const [keyId, delta] of frame.keys) {
      this.pendingKeys.set(keyId, (this.pendingKeys.get(keyId) || 0) + delta);
    }
    for (let i = 0; i < 5; i++) this.pendingClicks[i] += frame.clicks[i] || 0;
    this.pendingWheel[0] += frame.wheel[0] || 0;
    this.pendingWheel[1] += frame.wheel[1] || 0;
    this.pendingDx += frame.dx || 0;
    this.pendingDy += frame.dy || 0;
    if (frame.grid.length) this.pendingGrid.push(...frame.grid);
    this.schedule();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 最近一次 flush 的增量；订阅回调里读取。 */
  getDeltas(): LiveDeltas {
    return this.published;
  }

  reset(): void {
    this.clearPending();
    this.published = { seq: this.lastSeq, ts: 0, keys: new Map(), clicks: emptyClicks(), wheel: [0, 0], dx: 0, dy: 0, grid: [] };
  }

  /**
   * 重新开始一条流：重置 seq 水位与所有累计增量。
   * Tauri 重新订阅 / Rust 侧 seq 从 0 开始时调用，避免新帧被当成旧帧丢弃。
   */
  restart(seqBase = -1): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.lastSeq = seqBase;
    this.pendingWhenVisible = false;
    this.clearPending();
    this.published = { seq: seqBase, ts: 0, keys: new Map(), clicks: emptyClicks(), wheel: [0, 0], dx: 0, dy: 0, grid: [] };
  }

  private clearPending(): void {
    this.pendingKeys.clear();
    this.pendingClicks = emptyClicks();
    this.pendingWheel = [0, 0];
    this.pendingDx = 0;
    this.pendingDy = 0;
    this.pendingGrid = [];
  }

  private schedule(): void {
    if (typeof window === 'undefined') return;
    if (document.hidden) { this.pendingWhenVisible = true; return; }
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.flush();
    });
  }

  private flush(): void {
    if (document.hidden) { this.pendingWhenVisible = true; return; }
    const keys = this.pendingKeys;
    this.pendingKeys = new Map();
    const clicks = this.pendingClicks;
    this.pendingClicks = emptyClicks();
    const wheel: [number, number] = [this.pendingWheel[0], this.pendingWheel[1]];
    this.pendingWheel = [0, 0];
    const dx = this.pendingDx, dy = this.pendingDy;
    this.pendingDx = 0;
    this.pendingDy = 0;
    const grid = this.pendingGrid;
    this.pendingGrid = [];
    this.published = { seq: this.lastSeq, ts: Date.now(), keys, clicks, wheel, dx, dy, grid };
    for (const listener of Array.from(this.listeners)) listener();
  }
}

export const liveStore = new LiveStore();
