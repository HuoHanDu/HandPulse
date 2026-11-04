import { LEVELS, displayKey } from '../mock/mock';
import type { KeyStat } from '../ipc/types';

interface Props {
  keyStats: KeyStat[];
  total: number;
  sel: string | null;
  empty: boolean;
  viewReset: boolean;
  onPick(label: string): void;
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

export function Top10List({ keyStats, total, sel, empty, viewReset, onPick }: Props) {
  const rows = keyStats.slice(0, 10).map(stat => ({
    label: stat.label,
    count: empty || viewReset ? 0 : stat.count
  })).sort((a, b) => b.count - a.count);
  const max = rows[0] ? rows[0].count : 0;
  const totalCur = empty || viewReset ? 0 : total;

  return (
    <div className="top10-table" id="top10Table">
      <div className="t10-head"><span>#</span><span>键位</span><span></span><span>次数</span><span>占比</span></div>
      {rows.map((r, i) => {
        const lv = levelByMax(r.count, max);
        const L = LEVELS[lv];
        return (
          <div
            key={r.label}
            className={'t10-row' + (sel === r.label ? ' is-sel' : '')}
            data-k={r.label}
            role="button"
            tabIndex={0}
            onClick={() => onPick(r.label)}
          >
            <span className="t10-rank mono">{i + 1}</span>
            <span className="t10-key">{displayKey(r.label)}</span>
            <span className="t10-bar"><i style={{ width: (max ? Math.max(1, r.count / max * 100) : 0) + '%', background: L.c }} /></span>
            <span className="t10-count mono">{r.count.toLocaleString('en-US')}</span>
            <span className="t10-share mono">{((totalCur ? r.count / totalCur : 0) * 100).toFixed(1) + '%'}</span>
          </div>
        );
      })}
    </div>
  );
}
