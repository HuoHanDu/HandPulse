import type { HistogramChart } from '../ipc/types';
import { LEVELS, displayKey } from '../mock/mock';
import { useSize } from './useSize';

function niceStep(x: number): number {
  if (!isFinite(x) || x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

function levelByMax(count: number, max: number): number {
  if (!count || !max) return 0;
  const r = count / max;
  if (r > 0.75) return 5;
  if (r > 0.45) return 4;
  if (r > 0.2) return 3;
  if (r > 0.05) return 2;
  return 1;
}

interface Props {
  chart: HistogramChart;
  empty: boolean;
  onReadout(text: string): void;
}

export function Histogram({ chart, empty, onReadout }: Props) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const W = Math.max(280, w), H = Math.max(120, h);
  const nf = (v: number) => v.toLocaleString('en-US');

  if (chart.dim === 'top20') {
    const m = { l: 12, r: 12, t: 10, b: 8 };
    const rowH = (H - m.t - m.b) / 10;
    const half = (W - m.l - m.r - 18) / 2;
    const maxT = chart.items[0]?.value || 1;
    const rows = chart.items.slice(0, 20).map((t, i) => {
      const col = i < 10 ? 0 : 1;
      const row = i % 10;
      const ox = m.l + col * (half + 18);
      const oy = m.t + row * rowH;
      const cx = m.l + col * (half + 18) + 44;
      const bw = half - 44 - 44;
      const v = empty ? 0 : t.value;
      const lv = levelByMax(v, maxT);
      const y = oy + rowH / 2;
      return { i, ox, y, cx, bw, v, lv, label: displayKey(t.label) };
    });
    return (
      <div ref={ref} style={{ width: '100%', height: '100%' }}>
        <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={chart.aria}>
          {rows.map(r => (
            <g key={r.i}>
              <text x={r.ox} y={(r.y + 4).toFixed(1)} fontSize="12" fill="#a7b1bd" fontFamily="JetBrains Mono, monospace">{r.label}</text>
              <rect x={r.cx} y={(r.y - 3.5).toFixed(1)} width={r.bw} height="7" rx="2" fill="#1b1e23" />
              <rect x={r.cx} y={(r.y - 3.5).toFixed(1)} width={Math.max(1, r.v / maxT * r.bw).toFixed(1)} height="7" rx="2" fill={LEVELS[Math.max(1, r.lv)].c} />
              <text x={r.ox + half - 2} y={(r.y + 4).toFixed(1)} fontSize="12" textAnchor="end" fill="#e9edf3" fontFamily="JetBrains Mono, monospace">{nf(r.v)}</text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  const log = chart.log;
  const mg = { l: 44, r: 12, t: log ? 22 : 12, b: 26 };
  const pw = Math.max(20, W - mg.l - mg.r);
  const ph = Math.max(20, H - mg.t - mg.b);
  const max = chart.max || 1;
  let step = 1, ymax = 1;
  if (log) {
    ymax = Math.log10(max + 1);
  } else {
    step = niceStep(max / 3);
    ymax = Math.max(step, Math.ceil(max / step) * step);
  }
  const vals = empty ? chart.items.map(() => 0) : chart.items.map(i => i.value);
  const n = vals.length;
  const slot = pw / n;
  const bw = Math.min(30, Math.max(6, slot * 0.6));
  const yTicks: number[] = [];
  if (!log) {
    for (let v = 0; v <= ymax + 0.001; v += step) yTicks.push(Number(v.toFixed(6)));
  } else {
    [1, 10, 100, 1000, 10000].forEach(t => {
      if (Math.log10(t + 1) > ymax) return;
      yTicks.push(t);
    });
  }
  const bars = vals.map((val, i) => {
    const frac = empty ? 0 : (log ? Math.log10(val + 1) / ymax : val / ymax);
    const bh = empty ? 1 : Math.max(1, frac * ph);
    const bx = mg.l + i * slot + (slot - bw) / 2;
    const by = mg.t + ph - bh;
    return { i, val, bx, by, bh };
  });

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={chart.aria}>
        {!log && yTicks.map(v => {
          const yy = mg.t + ph - (v / ymax) * ph;
          return (
            <g key={v}>
              <line x1={mg.l} y1={yy.toFixed(1)} x2={W - mg.r} y2={yy.toFixed(1)} stroke={v === 0 ? '#2a2e35' : '#1b1e23'} />
              <text x={mg.l - 6} y={(yy + 4).toFixed(1)} textAnchor="end" fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{nf(v)}</text>
            </g>
          );
        })}
        {log && (
          <>
            <text x={W - mg.r} y={mg.t - 10} textAnchor="end" fontSize="12" fill="#8a94a1">纵轴为对数刻度（1–{nf(max)}）</text>
            {yTicks.map(t => {
              const yy = mg.t + ph - (Math.log10(t) / ymax) * ph;
              return (
                <g key={t}>
                  <line x1={mg.l} y1={yy.toFixed(1)} x2={W - mg.r} y2={yy.toFixed(1)} stroke="#1b1e23" />
                  <text x={mg.l - 6} y={(yy + 4).toFixed(1)} textAnchor="end" fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{nf(t)}</text>
                </g>
              );
            })}
          </>
        )}
        {bars.map(b => (
          <g key={b.i}>
            <rect
              className="hbar"
              data-i={b.i}
              x={b.bx.toFixed(1)}
              y={b.by.toFixed(1)}
              width={bw.toFixed(1)}
              height={b.bh.toFixed(1)}
              rx="1.5"
              fill={log ? '#5f7f9e' : '#3d6a94'}
              onMouseEnter={() => {
                const item = chart.items[b.i];
                if (!item) return;
                onReadout(chart.dim === 'hours'
                  ? item.label + ' 时，' + nf(item.value) + ' 次'
                  : item.label + ' ms，' + nf(item.value) + ' 次');
              }}
            />
            {log && !empty && (
              <text x={(b.bx + bw / 2).toFixed(1)} y={(b.by - 5).toFixed(1)} textAnchor="middle" fontSize="12" fill="#e9edf3" fontFamily="JetBrains Mono, monospace">{nf(b.val)}</text>
            )}
            <text x={(mg.l + b.i * slot + slot / 2).toFixed(1)} y={H - 8} textAnchor="middle" fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{chart.items[b.i]?.label}</text>
          </g>
        ))}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="#8a94a1">该时段无记录</text>}
      </svg>
    </div>
  );
}
