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

function Legend({ x, y, minLabel, maxLabel }: { x: number; y: number; minLabel: string; maxLabel: string }) {
  return (
    <g>
      <text x={x} y={y + 9} fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{minLabel}</text>
      {LEVELS.map((L, i) => (
        <rect key={i} x={x + 26 + i * 13} y={y} width="10" height="10" rx="1" fill={L.c} />
      ))}
      <text x={x + 26 + 6 * 13 + 6} y={y + 9} fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{maxLabel}</text>
    </g>
  );
}

interface Props {
  chart: HeatmapChart;
  empty: boolean;
  onReadout(text: string): void;
}

export function CalendarHeatmap({ chart, empty, onReadout }: Props) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const W = Math.max(280, w), H = Math.max(120, h);
  const cl = 22;
  const cols = 54;
  const cellW = (W - cl - 8) / cols;
  const cellH = cellW;
  const gridH = 7 * cellH;
  const ct = 22 + Math.max(0, (H - 22 - 58 - gridH) / 2);
  const max = chart.max || 1;
  const nf = (v: number) => v.toLocaleString('en-US');

  let lastX = -100;
  const months: Array<{ label: string; x: number }> = [];
  (chart.months ?? []).slice().sort((a, b) => a.col - b.col).forEach(m => {
    const x = cl + m.col * cellW;
    if (x - lastX < 26) return;
    lastX = x;
    months.push({ label: m.label, x });
  });

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={chart.aria}>
        {chart.cells.map((cell, i) => {
          const x = cl + cell.x * cellW;
          const y = ct + cell.y * cellH;
          const lv = levelByMax(empty ? 0 : cell.v, max);
          const isToday = i === chart.cells.length - 1;
          return (
            <rect
              key={i}
              className="ccell"
              data-i={i}
              x={(x + 0.5).toFixed(1)}
              y={(y + 0.5).toFixed(1)}
              width={Math.max(1, cellW - 1).toFixed(1)}
              height={Math.max(1, cellH - 1).toFixed(1)}
              rx="1"
              fill={empty ? LEVELS[0].c : LEVELS[lv].c}
              stroke={isToday ? '#4c8dff' : undefined}
              strokeWidth={isToday ? '1.2' : undefined}
              onMouseEnter={() => onReadout((cell.iso ?? '') + '，' + nf(cell.v) + ' 次')}
            />
          );
        })}
        {months.map(m => (
          <text key={m.label} x={m.x.toFixed(1)} y={ct - 8} fontSize="12" fill="#8a94a1">{m.label}</text>
        ))}
        <text x={cl} y={ct + gridH + 26} fontSize="12" fill="#8a94a1">{chart.footnote ?? ''}</text>
        <Legend x={cl} y={H - 18} minLabel={chart.legendMin ?? '少'} maxLabel={chart.legendMax ?? ''} />
      </svg>
    </div>
  );
}
