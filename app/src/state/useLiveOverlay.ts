import { useEffect, useRef, useState } from 'react';
import { liveStore } from './liveStore';

/**
 * 历史查询（DB + 当前桶，最多 1s 前）之上的「即时增量」。
 *
 * - 页面拿到一份历史数据时，记录当时 liveStore 的 seq 作为基线；
 * - 之后每个实时帧的 keys/clicks/wheel/move/grid 叠加到基线之上，按下键立刻反映到 UI；
 * - 下一次历史数据回来时重置基线，避免与 DB 中的当前桶重复计数。
 */
export interface LiveOverlay {
  keyCount: Map<number, number>;
  keysTotal: number;
  clicks: [number, number, number, number, number];
  clicksTotal: number;
  wheel: [number, number];
  movePx: number;
  grid: Map<string, number>;
  pairs: Map<number, number>;
  pairGap: Map<number, number>;
}

export function emptyOverlay(): LiveOverlay {
  return {
    keyCount: new Map(),
    keysTotal: 0,
    clicks: [0, 0, 0, 0, 0],
    clicksTotal: 0,
    wheel: [0, 0],
    movePx: 0,
    grid: new Map(),
    pairs: new Map(),
    pairGap: new Map()
  };
}

function addDeltas(prev: LiveOverlay, d: ReturnType<typeof liveStore.getDeltas>): LiveOverlay {
  const keyCount = new Map(prev.keyCount);
  let keysTotal = prev.keysTotal;
  d.keys.forEach((delta, keyId) => {
    if (!delta) return;
    keyCount.set(keyId, (keyCount.get(keyId) || 0) + delta);
    keysTotal += delta;
  });
  const clicks: [number, number, number, number, number] = [
    prev.clicks[0] + d.clicks[0],
    prev.clicks[1] + d.clicks[1],
    prev.clicks[2] + d.clicks[2],
    prev.clicks[3] + d.clicks[3],
    prev.clicks[4] + d.clicks[4]
  ];
  const clicksTotal = prev.clicksTotal + d.clicks[0] + d.clicks[1] + d.clicks[2] + d.clicks[3] + d.clicks[4];
  const grid = prev.grid.size ? new Map(prev.grid) : new Map<string, number>();
  d.grid.forEach(([x, y]) => {
    const k = x + ',' + y;
    grid.set(k, (grid.get(k) || 0) + 1);
  });
  const pairs = new Map(prev.pairs);
  d.pairs.forEach((delta, pair) => {
    if (delta) pairs.set(pair, (pairs.get(pair) || 0) + delta);
  });
  const pairGap = new Map(prev.pairGap);
  d.pairGap.forEach((delta, key) => {
    if (delta) pairGap.set(key, (pairGap.get(key) || 0) + delta);
  });
  return {
    keyCount,
    keysTotal,
    clicks,
    clicksTotal,
    wheel: [prev.wheel[0] + d.wheel[0], prev.wheel[1] + d.wheel[1]],
    movePx: prev.movePx + Math.hypot(d.dx, d.dy),
    grid,
    pairs,
    pairGap
  };
}

/**
 * @param resetToken 历史数据对象；每次变化（range 切换 / 1s 查询返回）重置基线。
 */
export function useLiveOverlay(resetToken: unknown): LiveOverlay {
  const overlayRef = useRef<LiveOverlay>(emptyOverlay());
  const baselineRef = useRef(-1);
  const [, bump] = useState(0);

  useEffect(() => {
    baselineRef.current = liveStore.getSeq();
    overlayRef.current = emptyOverlay();
    bump(v => v + 1);
  }, [resetToken]);

  useEffect(() => {
    const stop = liveStore.subscribe(() => {
      const d = liveStore.getDeltas();
      if (d.seq < 0 || d.seq <= baselineRef.current) return;
      overlayRef.current = addDeltas(overlayRef.current, d);
      bump(v => v + 1);
    });
    return stop;
  }, []);

  return overlayRef.current;
}
