import { useMemo, useRef, useState } from 'react';
import type { LineSeries } from '../ipc/types';
import { useSize } from './useSize';

function niceStep(x: number): number {
  if (!isFinite(x) || x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

interface Props {
  series: LineSeries;
  onReadout(text: string): void;
}

export function LineChart({ series, onReadout }: Props) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = Math.max(320, w), H = Math.max(120, h);
  const geom = useMemo(() => {
    const m = { l: 46, r: 16, t: 16, b: 22 };
    const pw = Math.max(20, W - m.l - m.r);
    const ph = Math.max(20, H - m.t - m.b);
    const maxVal = Math.max(...series.values) || 1;
    const step = niceStep(maxVal / 4);
    const ymax = Math.max(step, Math.ceil(maxVal / step) * step);
    const n = series.values.length;
    const X = (i: number) => m.l + (series.xMode === 'time' ? (i / series.xMax) * pw : (n <= 1 ? 0 : (i / (n - 1)) * pw));
    const Y = (v: number) => m.t + ph - (v / ymax) * ph;
    const pts = series.values.map((v, i) => [X(i), Y(v)] as [number, number]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ' L' + pts[n - 1][0].toFixed(1) + ' ' + (m.t + ph) + ' L' + pts[0][0].toFixed(1) + ' ' + (m.t + ph) + ' Z';
    return { m, pw, ph, ymax, step, n, X, Y, pts, line, area };
  }, [series, W, H]);

  const fmtNum = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.round(v));
  const peakVal = series.peak.val >= 1000 ? series.peak.val.toLocaleString('en-US') : String(series.peak.val);
  const { m, pw, ph, ymax, step, n, Y, pts, line, area } = geom;

  const yLines: number[] = [];
  for (let v = 0; v <= ymax + 0.001; v += step) yLines.push(Number(v.toFixed(6)));
  if (yLines[yLines.length - 1] < ymax) yLines.push(ymax);

  const peak = pts[series.peak.idx] ?? pts[0];
  const anchor = peak && peak[0] > W - 120 ? 'end' : 'start';
  const lx = peak ? (anchor === 'end' ? peak[0] - 7 : peak[0] + 7) : 0;
  const ly = peak ? Math.max(14, peak[1] - 8) : 0;
  const cross = hover != null ? pts[hover] : null;

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={'0 0 ' + W + ' ' + H}
        role="img"
        aria-label={series.aria}
        onMouseMove={(e) => {
          if (!svgRef.current) return;
          const rect = svgRef.current.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          let idx = series.xMode === 'time'
            ? Math.round((mx - m.l) / pw * series.xMax)
            : Math.round((mx - m.l) / pw * (n - 1));
          idx = Math.max(0, Math.min(n - 1, idx));
          setHover(idx);
          onReadout(series.tip(idx));
        }}
        onMouseLeave={() => {
          setHover(null);
          onReadout(series.peakText);
        }}
      >
        {yLines.map(v => {
          const yy = Y(v);
          return (
            <g key={v}>
              <line x1={m.l} y1={yy.toFixed(1)} x2={W - m.r} y2={yy.toFixed(1)} stroke={v === 0 ? '#2a2e35' : '#1b1e23'} strokeWidth="1" />
              <text x={m.l - 8} y={(yy + 4).toFixed(1)} textAnchor="end" fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{fmtNum(v)}</text>
            </g>
          );
        })}
        {series.xTicks.map((t, i) => {
          const xx = m.l + t.pos * pw;
          return (
            <g key={i}>
              <line x1={xx.toFixed(1)} y1={m.t} x2={xx.toFixed(1)} y2={m.t + ph} stroke="#161a20" />
              <text x={xx.toFixed(1)} y={H - 6} textAnchor="middle" fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{t.label}</text>
            </g>
          );
        })}
        <path d={area} fill="rgba(216,224,236,0.10)" />
        <path d={line} fill="none" stroke="#eef2f7" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        {series.xMode === 'time' && (
          <line
            x1={(m.l + (series.values.length - 1) / 1440 * pw).toFixed(1)}
            y1={m.t}
            x2={(m.l + (series.values.length - 1) / 1440 * pw).toFixed(1)}
            y2={m.t + ph}
            stroke="#4c8dff"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.55"
          />
        )}
        {peak && <circle cx={peak[0].toFixed(1)} cy={peak[1].toFixed(1)} r="3" fill="#4c8dff" />}
        {peak && (
          <text x={lx.toFixed(1)} y={ly.toFixed(1)} textAnchor={anchor} fontSize="12" fill="#e9edf3" fontFamily="JetBrains Mono, monospace">{peakVal}</text>
        )}
        {cross && (
          <g style={{ display: '' }}>
            <line x1={cross[0]} y1={m.t} x2={cross[0]} y2={m.t + ph} stroke="#4c8dff" strokeWidth="1" />
            <circle cx={cross[0]} cy={cross[1]} r="3.5" fill="none" stroke="#4c8dff" strokeWidth="1.5" />
          </g>
        )}
      </svg>
    </div>
  );
}
