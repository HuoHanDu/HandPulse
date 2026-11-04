import type { MouseExtra } from '../ipc/types';

interface Props {
  extra: MouseExtra;
  factor: number;
  empty: boolean;
}

export function MetricList({ extra, factor, empty }: Props) {
  const f = empty ? 0 : factor;
  const nf = (v: number) => v.toLocaleString('en-US');
  const c = extra.clicks;
  const total = Math.round(c.total * f);
  const items: Array<[string, number | string, string]> = [
    ['总点击', total, ''],
    ['左键', Math.round(c.left * f), ''],
    ['右键', Math.round(c.right * f), ''],
    ['中键', Math.round(c.middle * f), ''],
    ['侧键', Math.round((c.side1 + c.side2) * f), ''],
    ['滚轮', '↑' + nf(Math.round(extra.wheel[0] * f)) + ' / ↓' + nf(Math.round(extra.wheel[1] * f)), ''],
    ['移动', '≈ ' + (extra.moveKm * f).toFixed(1), 'km'],
    ['峰值速度', extra.peakSpeed.toFixed(1), 'm/s']
  ];
  return (
    <div className="metrics" id="metrics">
      {items.map(([label, value, unit]) => (
        <div className="metric" key={label}>
          <span className="metric-l">{label}</span>
          <span className="metric-v mono">
            {typeof value === 'number' ? nf(value) : value}
            {unit ? <small>{unit}</small> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
