import { useEffect, useRef } from 'react';
import { useApp } from '../app/store';
import { liveStore } from '../state/liveStore';
import type { MouseExtra } from '../ipc/types';

interface Props {
  extra: MouseExtra;
  factor: number;
  empty: boolean;
}

const FLASH_IDS = ['mLeft', 'mRight', 'mWheel', 'mSide1', 'mSide2'];

export function MouseSvg({ extra, factor, empty }: Props) {
  const { state } = useApp();
  const ref = useRef<SVGSVGElement>(null);
  const pausedRef = useRef(state.paused);
  pausedRef.current = state.paused;
  const lastFlash = useRef(0);

  const f = empty ? 0 : factor;
  const n = (v: number) => Math.round(v * f).toLocaleString('en-US');

  useEffect(() => {
    const stop = liveStore.subscribe(() => {
      if (pausedRef.current || state.empty) return;
      const deltas = liveStore.getDeltas();
      const clicked = deltas.clicks.some(v => v > 0);
      if (!clicked && !deltas.wheel[0] && !deltas.wheel[1]) return;
      if (Date.now() - lastFlash.current < 300) return;
      lastFlash.current = Date.now();
      const svg = ref.current;
      if (!svg) return;
      const id = (deltas.wheel[0] || deltas.wheel[1])
        ? 'mWheel'
        : FLASH_IDS[Math.floor(Math.random() * FLASH_IDS.length)];
      const el = svg.querySelector('#' + id);
      if (!el) return;
      el.classList.add('lit');
      window.setTimeout(() => el.classList.remove('lit'), 120);
    });
    return stop;
  }, [state.empty]);

  return (
    <svg
      ref={ref}
      id="mouseSvg"
      width="288"
      height="232"
      viewBox="0 0 288 232"
      role="img"
      aria-label="鼠标俯视图，显示左键、右键、中键、双侧键与滚轮的点击次数"
    >
      <path className="m-case" d="M144 10 C176 10 196 34 200 72 L204 168 C206 204 180 224 144 224 C108 224 82 204 84 168 L88 72 C92 34 112 10 144 10 Z" />
      <path className="m-btn" id="mLeft" d="M144 12 C114 12 92 34 90 72 L90 104 H144 Z" />
      <path className="m-btn" id="mRight" d="M144 12 C174 12 196 34 198 72 L198 104 H144 Z" />
      <line x1="144" y1="12" x2="144" y2="104" stroke="#2c3138" strokeWidth="1" />
      <line x1="90" y1="104" x2="198" y2="104" stroke="#2c3138" strokeWidth="1" />
      <rect className="m-wheel" id="mWheel" x="136" y="50" width="16" height="34" rx="8" />
      <rect className="m-side" id="mSide1" x="76" y="84" width="9" height="17" rx="2.5" />
      <rect className="m-side" id="mSide2" x="76" y="110" width="9" height="17" rx="2.5" />
      <text className="m-num" id="mLeftN" x="112" y="74" textAnchor="middle">{n(extra.clicks.left)}</text>
      <text className="m-lbl" x="112" y="92" textAnchor="middle">左键</text>
      <text className="m-num" id="mRightN" x="176" y="74" textAnchor="middle">{n(extra.clicks.right)}</text>
      <text className="m-lbl" x="176" y="92" textAnchor="middle">右键</text>
      <text className="m-lbl" x="144" y="128" textAnchor="middle">中键</text>
      <text className="m-num" id="mMid" x="144" y="146" textAnchor="middle">{n(extra.clicks.middle)}</text>
      <line x1="200" y1="66" x2="220" y2="66" stroke="#2c3138" strokeWidth="1" />
      <text className="m-lbl" x="226" y="54">滚轮</text>
      <text className="m-num" id="mUp" x="226" y="72">↑{n(extra.wheel[0])}</text>
      <text className="m-num" id="mDown" x="226" y="90">↓{n(extra.wheel[1])}</text>
      <text className="m-lbl" x="68" y="92" textAnchor="end">侧键</text>
      <text className="m-num" id="mSideN" x="68" y="110" textAnchor="end">{n(extra.clicks.side1 + extra.clicks.side2)}</text>
      <text className="m-lbl" x="144" y="196" textAnchor="middle">总点击</text>
      <text className="m-num" id="mTotal" x="144" y="214" textAnchor="middle">{n(extra.clicks.total)}</text>
    </svg>
  );
}
