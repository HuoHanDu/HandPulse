import type { CSSProperties } from 'react';
import { LEVELS, displayKey } from '../mock/mock';
import type { KeyStat } from '../ipc/types';

const LEGEND_LABELS = ['无', '很低', '低', '中', '高', '最高'];

interface Props {
  keyStats: KeyStat[];
  sel: string | null;
  empty: boolean;
  viewReset: boolean;
  onPick(label: string): void;
}

export function LegendChips({ keyStats, sel, empty, viewReset, onPick }: Props) {
  const top8 = keyStats.slice(0, 8);
  return (
    <>
      <div className="legend" id="legend">
        <span className="legend-title">热力</span>
        {LEVELS.map((L, i) => (
          <span className="legend-item" key={i}>
            <i style={{ ['--c' as string]: L.c } as CSSProperties} />
            {LEGEND_LABELS[i]}
          </span>
        ))}
      </div>
      <div className="chips" id="chips">
        <span className="chips-label">高频键</span>
        {top8.map(stat => {
          const cnt = empty || viewReset ? 0 : stat.count;
          return (
            <button
              key={stat.label}
              type="button"
              className={'chip' + (sel === stat.label ? ' is-sel' : '')}
              data-k={stat.label}
              title={`${displayKey(stat.label)}，${cnt.toLocaleString('en-US')} 次`}
              onClick={() => onPick(stat.label)}
            >
              {displayKey(stat.label)}
            </button>
          );
        })}
      </div>
    </>
  );
}
