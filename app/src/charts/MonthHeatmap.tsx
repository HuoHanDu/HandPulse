import type { HeatmapChart } from '../ipc/types';
import { LEVELS } from '../mock/mock';
import { useSize } from './useSize';

function levelByMax(count: number, max: number): number {
  if (!count || !max) return 0;
  const r = count / max;
  if (r > 0.75) return 5;
  if (r > 0.45) return 4;
  if (r > 0.2) return 3;
  if (r > 0.05) return 2;
  return 1;
}

function localIso(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

interface Props {
  chart: HeatmapChart;
  empty: boolean;
  onReadout(text: string): void;
}

/** 单月日历热力：7 列 × 5/6 行，格子里带日期。 */
export function MonthHeatmap({ chart, empty, onReadout }: Props) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const W = Math.max(280, w), H = Math.max(150, h);
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const prefix = year + '-' + (month < 10 ? '0' : '') + month + '-';
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const weeks = Math.ceil((offset + days) / 7);
  const max = chart.max || 1;
  const nf = (v: number) => v.toLocaleString('en-US');

  const cells = new Map<string, { v: number; iso?: string }>();
  chart.cells.forEach((c) => {
    if (c.iso?.startsWith(prefix)) cells.set(c.iso, c);
  });

  const labelW = 36;
  const top = 22;
  const gap = 5;
  const cellW = Math.min(78, (W - labelW - 10 - gap * 6) / 7);
  // 6 行的月份不能超出面板；按可用高度压缩单元格。
  const cellH = Math.max(18, Math.min(38, (H - top - 26 - gap * (weeks - 1)) / weeks));
  const gridW = cellW * 7 + gap * 6;
  const gridH = cellH * weeks + gap * (weeks - 1);
  const left = labelW + Math.max(0, (W - labelW - 10 - gridW) / 2);
  const topY = top + Math.max(0, (H - top - 22 - gridH) / 2);
  const wd = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={chart.aria}>
        {wd.map((label, i) => (
          <text
            key={label}
            x={(left + i * (cellW + gap) + cellW / 2).toFixed(1)}
            y={20}
            textAnchor="middle"
            fontSize="11"
            fill="#8e8e93"
          >{label}</text>
        ))}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const day = i - offset + 1;
          const x = left + (i % 7) * (cellW + gap);
          const y = topY + Math.floor(i / 7) * (cellH + gap);
          if (day < 1 || day > days) {
            return null;
          }
          const iso = prefix + (day < 10 ? '0' : '') + day;
          const cell = cells.get(iso);
          const v = empty ? 0 : (cell?.v ?? 0);
          const lv = levelByMax(v, max);
          return (
            <g key={iso}>
              <rect
                x={x.toFixed(1)}
                y={y.toFixed(1)}
                width={cellW.toFixed(1)}
                height={cellH.toFixed(1)}
                rx="6"
                fill={LEVELS[lv].c}
                stroke={iso === localIso(today) ? '#4c8dff' : 'rgba(255,255,255,.06)'}
                strokeWidth={iso === localIso(today) ? '1.4' : '1'}
                onMouseEnter={() => onReadout(iso + '，' + nf(v) + ' 次')}
              />
              <text x={(x + 7).toFixed(1)} y={(y + 16).toFixed(1)} fontSize="11" fill="#e9edf3">{day}</text>
              <text x={(x + cellW - 7).toFixed(1)} y={(y + cellH - 8).toFixed(1)} textAnchor="end" fontSize="10" fill="#a7b1bd">
                {v > 0 ? nf(v) : ''}
              </text>
            </g>
          );
        })}
        <text x={left} y={H - 8} fontSize="11" fill="#8e8e93">
          {year} 年 {month} 月 · 最高 {nf(chart.max)} 次/天
        </text>
      </svg>
    </div>
  );
}
