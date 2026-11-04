import { HP } from '../mock/mock';
import { liveStore } from '../state/liveStore';
import type { LiveFrame } from './types';

/**
 * 实时数据源。
 *
 * M1：mock ticker，每 100ms 产一帧（键盘随机一个加权键、鼠标随机点击/滚轮/位移、网格命中）。
 * M2：替换为 `new Channel<LiveFrame>()` + `invoke('subscribe_live', { channel })`，
 *      前端调用点（`startLive().then(stop => …)`）不变。
 */
export function startLive(): Promise<() => void> {
  const keyList = HP.keyList.slice(0, 40) as Array<{ label: string; count: number }>;
  const keyIndex = new Map<string, number>();
  (HP.keyboard.keys as Array<{ label: string }>).forEach((k, i) => keyIndex.set(k.label, i));
  const weighted: Array<[number, number]> = keyList.map(k => [keyIndex.get(k.label) ?? 0, k.count]);
  const totalWeight = weighted.reduce((a, [, w]) => a + w, 0);

  function pickKey(): [number, number] | null {
    let r = Math.random() * totalWeight;
    for (const [id, w] of weighted) {
      r -= w;
      if (r <= 0) return [id, 1];
    }
    return [weighted[0][0], 1];
  }

  let seq = 0;
  const timer = window.setInterval(() => {
    const keys: Array<[number, number]> = [];
    if (Math.random() < 0.4) {
      const k = pickKey();
      if (k) keys.push(k);
    }
    const clicks: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    if (Math.random() < 0.5) clicks[Math.floor(Math.random() * 5)] = 1;
    const wheel: [number, number] = Math.random() < 0.12
      ? (Math.random() < 0.55 ? [1, 0] : [0, 1])
      : [0, 0];
    const grid: Array<[number, number]> = Math.random() < 0.25
      ? [[Math.floor(Math.random() * 32), Math.floor(Math.random() * 18)]]
      : [];
    const frame: LiveFrame = {
      seq: seq++,
      ts: Date.now(),
      keys,
      clicks,
      wheel,
      dx: Math.round((Math.random() - 0.5) * 40),
      dy: Math.round((Math.random() - 0.5) * 40),
      grid
    };
    liveStore.push(frame);
  }, 100);

  return Promise.resolve(() => window.clearInterval(timer));
}
