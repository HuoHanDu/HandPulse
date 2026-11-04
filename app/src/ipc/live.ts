import { Channel, invoke } from '@tauri-apps/api/core';
import { HP } from '../mock/mock';
import { isTauri } from './client';
import { liveStore } from '../state/liveStore';
import type { LiveFrame } from './types';

/**
 * 实时数据源。
 *
 * - Tauri：`Channel<LiveFrame>` + `subscribe_live`，Rust 有事件时 20ms 一批、空闲 100ms 心跳；
 * - 浏览器 dev：100ms mock ticker；
 * 两条路径都走 `liveStore`，键盘/鼠标/时间轴只认 store 的增量。
 */

const WATCHDOG_MS = 2000;
/** 首次连接的退避重试（有上限，失败后交给 onError + 看门狗低频重试）。 */
const RETRY_DELAYS = [400, 800, 1600, 3200];

export interface StartLiveOptions {
  /** 暂停时跳过看门狗，避免 Rust 停发帧被误判成断线。 */
  isPaused?: () => boolean;
  /** 连接失败回调（只提示一次，成功后复位）。 */
  onError?: (message: string) => void;
}

export async function startLive(options: StartLiveOptions = {}): Promise<() => void> {
  liveStore.restart();
  if (isTauri) return startTauriLive(options);
  return startMockLive();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function startTauriLive(options: StartLiveOptions): Promise<() => void> {
  let stopped = false;
  let connecting = false;
  let lastFrame = Date.now();
  let notified = false;

  const reportError = (message: string) => {
    if (notified) return;
    notified = true;
    options.onError?.(message);
  };

  const connectOnce = async () => {
    const channel = new Channel<LiveFrame>();
    channel.onmessage = (frame) => {
      lastFrame = Date.now();
      liveStore.push(frame);
    };
    await invoke('subscribe_live', { channel });
    lastFrame = Date.now();
    notified = false;
  };

  const connect = async (burst: boolean) => {
    if (stopped || connecting) return;
    connecting = true;
    try {
      const attempts = burst ? RETRY_DELAYS.length + 1 : 1;
      for (let i = 0; i < attempts; i++) {
        try {
          await connectOnce();
          return;
        } catch (err) {
          if (stopped) return;
          if (i < attempts - 1) {
            await sleep(RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)]);
          } else {
            reportError('实时采集连接失败：' + errorText(err));
          }
        }
      }
    } finally {
      connecting = false;
    }
  };

  await connect(true);

  // 心跳看门狗：Rust 空闲时每 100ms 仍会发空帧；超过 2s 没帧就重建订阅。
  const watchdog = window.setInterval(() => {
    if (stopped) return;
    if (options.isPaused?.()) {
      // 暂停期间 Rust 不发帧，保持水位新鲜；恢复后不会误触发重订阅
      lastFrame = Date.now();
      return;
    }
    if (Date.now() - lastFrame < WATCHDOG_MS) return;
    lastFrame = Date.now();
    void connect(false);
  }, WATCHDOG_MS);

  return async () => {
    stopped = true;
    window.clearInterval(watchdog);
    try {
      await invoke('unsubscribe_live');
    } catch {
      // 窗口关闭/命令未注册时忽略
    }
  };
}

/** 浏览器 mock：每 100ms 产一帧，走与真实 Channel 相同的 liveStore 链路。 */
function startMockLive(): () => void {
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

  return () => window.clearInterval(timer);
}
