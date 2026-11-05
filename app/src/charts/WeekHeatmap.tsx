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

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

function HeatLegend({ x, y, minLabel, maxLabel }: { x: number; y: number; minLabel: string; maxLabel: string }) {
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

export function WeekHeatmap({ chart, empty, onReadout }: Props) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const W = Math.max(280, w), H = Math.max(120, h);
  const left = 36, top = 6, bottom = 40;
  const cw = (W - left - 8) / 24, ch = (H - top - bottom) / 7;
  const labels = chart.weekLabels ?? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const todayWd = (new Date().getDay() + 6) % 7;
  const max = chart.max || 1;

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={chart.aria}>
        {Array.from({ length: 7 }, (_, wd) => {
          const yy = top + wd * ch;
          return (
            <g key={wd}>
              <text x={left - 8} y={(yy + ch / 2 + 4).toFixed(1)} textAnchor="end" fontSize="12" fill={wd === todayWd ? '#9cc0ff' : '#8a94a1'} fontFamily="Noto Sans SC, sans-serif">{labels[wd]}</text>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = chart.cells.find(c => c.x === hour && c.y === wd);
                const v = empty ? 0 : (cell?.v ?? 0);
                const lv = levelByMax(v, max);
                const x = left + hour * cw;
                return (
                  <rect
                    key={hour}
                    className="hcell"
                    data-wd={wd}
                    data-h={hour}
                    x={(x + 0.5).toFixed(1)}
                    y={(yy + 0.5).toFixed(1)}
                    width={Math.max(1, cw - 1).toFixed(1)}
                    height={Math.max(1, ch - 1).toFixed(1)}
                    rx="1"
                    fill={LEVELS[lv].c}
                    stroke={wd === todayWd ? 'rgba(76,141,255,.45)' : undefined}
                    strokeWidth={wd === todayWd ? '0.5' : undefined}
                    onMouseEnter={() => onReadout(labels[wd] + ' ' + pad2(hour) + ' 时，' + v.toFixed(1) + ' 次/分')}
                  />
                );
              })}
            </g>
          );
        })}
        {[0, 3, 6, 9, 12, 15, 18, 21].map(hour => (
          <text key={hour} x={(left + hour * cw).toFixed(1)} y={H - 26} fontSize="12" fill="#8a94a1" fontFamily="JetBrains Mono, monospace">{pad2(hour)}</text>
        ))}
        <HeatLegend x={left} y={H - 16} minLabel={chart.legendMin ?? '0'} maxLabel={chart.legendMax ?? ''} />
      </svg>
    </div>
  );
}
