import type { CSSProperties, ReactNode } from 'react';
import { LEVELS } from '../mock/mock';
import type { Cell, Layer } from '../app/store';
import type { GridCell } from '../ipc/types';

interface Props {
  cells: GridCell[];
  factor: number;
  layer: Layer;
  empty: boolean;
  cell: Cell | null;
  onHover(cell: Cell): void;
  onSelect(cell: Cell): void;
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

export function ScreenGrid({ cells, factor, layer, empty, cell, onHover, onSelect }: Props) {
  const map = new Map<number, number>();
  cells.forEach(g => map.set(g.y * 32 + g.x, g.v));
  const max = cells.reduce((m, g) => (g.v > m ? g.v : m), 0);
  const f = empty ? 0 : factor;
  const nodes: ReactNode[] = [];
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 32; x++) {
      const raw = map.get(y * 32 + x) || 0;
      const v = empty ? 0 : Math.round(raw * f);
      const lv = levelByMax(empty ? 0 : raw, max);
      const L = LEVELS[lv];
      const selected = cell && cell.x === x && cell.y === y;
      nodes.push(
        <div
          key={y * 32 + x}
          className={'cell' + (v ? ' has' : '') + (selected ? ' sel' : '')}
          data-x={x}
          data-y={y}
          data-v={v}
          style={v ? ({ ['--fill' as string]: L.c, ['--ink' as string]: L.ink } as CSSProperties) : undefined}
          onMouseOver={() => onHover({ x, y, v })}
          onClick={() => onSelect({ x, y, v })}
        >
          {v || ''}
        </div>
      );
    }
  }
  return <div className="screen" id="screenGrid" data-layer={layer}>{nodes}</div>;
}
