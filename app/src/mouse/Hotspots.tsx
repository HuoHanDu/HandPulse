import { LEVELS } from '../mock/mock';
import type { Cell, Layer } from '../app/store';
import type { GridCell } from '../ipc/types';

interface Props {
  cells: GridCell[];
  factor: number;
  layer: Layer;
  empty: boolean;
  cell: Cell | null;
  onSelect(cell: Cell): void;
}

function zoneOf(x: number, y: number): string {
  const nx = (x + 0.5) / 32, ny = (y + 0.5) / 18;
  if (Math.abs(nx - 0.52) < 0.13 && Math.abs(ny - 0.62) < 0.15) return '准星区';
  if (nx > 0.75 && ny < 0.26) return '小地图';
  if (nx < 0.17 && ny < 0.19) return '菜单';
  return '其他区';
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

export function Hotspots({ cells, factor, layer, empty, cell, onSelect }: Props) {
  const f = empty ? 0 : (layer === 'clicks' ? factor : 1);
  const rows = cells.slice().sort((a, b) => b.v - a.v).slice(0, 6);
  const max = rows[0] ? rows[0].v : 1;

  return (
    <div className="hotspots" id="hotspots">
      {rows.map((g, i) => {
        const val = Math.round(g.v * f);
        const selected = cell && cell.x === g.x && cell.y === g.y;
        return (
          <div
            key={g.y * 32 + g.x}
            className={'hs-row' + (selected ? ' is-sel' : '')}
            data-x={g.x}
            data-y={g.y}
            onClick={() => onSelect({ x: g.x, y: g.y, v: val })}
          >
            <span className="hs-rank mono">{i + 1}</span>
            <span className="hs-pos mono">({g.x}, {g.y})</span>
            <span className="hs-zone">{zoneOf(g.x, g.y)}</span>
            <span className="hs-bar"><i style={{ width: Math.max(4, g.v / max * 100) + '%', background: LEVELS[levelByMax(g.v, max)].c }} /></span>
            <span className="hs-count mono">{val.toLocaleString('en-US')}</span>
          </div>
        );
      })}
    </div>
  );
}
