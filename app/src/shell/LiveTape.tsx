import { useEffect, useRef } from 'react';
import { HP } from '../mock/mock';
import { useApp } from '../app/store';

const CELLS = 600;
let rng = 20261104;
function rnd(): number {
  rng = (rng * 1664525 + 1013904223) >>> 0;
  return rng / 4294967296;
}

interface TapeCell {
  ev: number;
  idle: number;
}

function newCell(rate: number): TapeCell {
  return { ev: rnd() < rate / CELLS ? 0.45 + rnd() * 0.55 : 0, idle: 0.05 + rnd() * 0.06 };
}

/** 输入时间轴 canvas；与原型同一绘制规则与种子。 */
export function LiveTape() {
  const { state } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cellsRef = useRef<TapeCell[]>([]);

  const draw = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const box = cv.getBoundingClientRect();
    if (!box.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(box.width)), H = Math.max(1, Math.round(box.height));
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const mid = H / 2;
    const cw = W / CELLS;
    for (let t = 0; t < CELLS; t += 5) {
      const x0 = Math.round(t * cw);
      const big = t % 50 === 0;
      g.fillStyle = big ? '#2d333d' : '#1d2229';
      g.fillRect(x0, big ? 1 : 3, 1, big ? 5 : 2);
      g.fillRect(x0, H - (big ? 6 : 5), 1, big ? 5 : 2);
    }
    g.fillStyle = '#232831';
    g.fillRect(0, Math.round(mid), W, 1);
    for (let i = 0; i < CELLS; i++) {
      const c = cellsRef.current[i];
      if (!c) continue;
      const amp = c.ev ? c.ev : c.idle;
      const h = Math.max(0.7, amp * 10);
      g.fillStyle = c.ev ? 'rgba(226,234,245,' + (0.6 + 0.4 * c.ev).toFixed(2) + ')' : 'rgba(154,168,186,0.3)';
      g.fillRect(i * cw, mid - h, Math.max(1, cw - 0.35), h * 2);
    }
    g.fillStyle = '#4c8dff';
    g.fillRect(W - 2, 0, 2, H);
    g.fillRect(W - 2, 0, 2, 3);
  };

  useEffect(() => {
    const rate = (HP.perMinute.keys[HP.nowMinute] || 0) + (HP.perMinute.clicks[HP.nowMinute] || 0);
    rng = 20261104;
    cellsRef.current = Array.from({ length: CELLS }, () => newCell(rate));
    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (state.paused) return;
    const timer = window.setInterval(() => {
      const rate = (HP.perMinute.keys[HP.nowMinute] || 0) + (HP.perMinute.clicks[HP.nowMinute] || 0);
      cellsRef.current.shift();
      cellsRef.current.push(newCell(rate));
      draw();
    }, 100);
    return () => window.clearInterval(timer);
  }, [state.paused]);

  return (
    <div className={'tape' + (state.paused ? ' is-paused' : '')} id="tape">
      <span className="tape-label">输入时间轴</span>
      <span className="tape-meta mono">−60 秒</span>
      <canvas id="tapeCanvas" ref={canvasRef} />
      <span className="tape-meta mono">现在</span>
    </div>
  );
}
