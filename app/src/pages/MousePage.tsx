import { useMemo } from 'react';
import { useApp } from '../app/store';
import { isTauri, loadMouse } from '../ipc/client';
import { usePageData } from '../state/usePageData';
import { useLiveOverlay } from '../state/useLiveOverlay';
import { ScreenGrid } from '../mouse/ScreenGrid';
import { MetricList } from '../mouse/MetricList';
import { MouseSvg } from '../mouse/MouseSvg';
import { Hotspots } from '../mouse/Hotspots';

function zoneOf(x: number, y: number): string {
  const nx = (x + 0.5) / 32, ny = (y + 0.5) / 18;
  if (Math.abs(nx - 0.52) < 0.13 && Math.abs(ny - 0.62) < 0.15) return '准星区';
  if (nx > 0.75 && ny < 0.26) return '小地图';
  if (nx < 0.17 && ny < 0.19) return '菜单';
  return '其他区';
}

interface Props {
  active: boolean;
}

export function MousePage({ active }: Props) {
  const { state, dispatch } = useApp();
  const range = state.ranges.mouse;
  const { data } = usePageData(`mouse:${range}`, () => loadMouse(range));
  const overlay = useLiveOverlay(data);
  const extra = useMemo(() => {
    const base = data?.extra ?? {
      clicks: { left: 0, right: 0, middle: 0, side1: 0, side2: 0, total: 0 },
      wheel: [0, 0] as [number, number], peakSpeed: 0, moveKm: 0
    };
    if (!overlay.clicksTotal && !overlay.wheel[0] && !overlay.wheel[1] && !overlay.movePx) return base;
    return {
      ...base,
      clicks: {
        left: base.clicks.left + overlay.clicks[0],
        right: base.clicks.right + overlay.clicks[1],
        middle: base.clicks.middle + overlay.clicks[2],
        side1: base.clicks.side1 + overlay.clicks[3],
        side2: base.clicks.side2 + overlay.clicks[4],
        total: base.clicks.total + overlay.clicksTotal
      },
      wheel: [base.wheel[0] + overlay.wheel[0], base.wheel[1] + overlay.wheel[1]] as [number, number],
      moveKm: base.moveKm + overlay.movePx * 2.54 / 96 / 100000
    };
  }, [data, overlay]);
  const grid = useMemo(() => {
    const base = data?.grid ?? [];
    if (!overlay.grid.size) return base;
    const map = new Map<string, number>();
    base.forEach(g => map.set(g.x + ',' + g.y, g.v));
    overlay.grid.forEach((v, k) => map.set(k, (map.get(k) || 0) + v));
    return Array.from(map.entries()).map(([k, v]) => {
      const [x, y] = k.split(',').map(Number);
      return { x, y, v };
    });
  }, [data, overlay]);
  const summary = data
    ? {
      ...data.summary,
      clicks: data.summary.clicks + overlay.clicksTotal,
      actions: data.summary.actions + overlay.clicksTotal,
      moveKm: data.summary.moveKm + overlay.movePx * 2.54 / 96 / 100000
    }
    : data;

  const cells = state.layer === 'clicks' ? grid : (data?.moveGrid ?? grid);
  const factor = state.layer === 'clicks' ? (data?.factor ?? 1) : 1;

  let gridFoot = '准星区 —';
  if (data) {
    const total = grid.reduce((a, g) => a + g.v, 0);
    const cross = grid.reduce((a, g) => a + (zoneOf(g.x, g.y) === '准星区' ? g.v : 0), 0);
    gridFoot = state.empty
      ? '无记录'
      : `准星区 ${Math.round(cross).toLocaleString('en-US')} 次，占 ${total ? (cross / total * 100).toFixed(1) : '0.0'}%`;
  }

  const hotspotNote = state.empty
    ? '示例数据已清空。'
    : state.layer === 'clicks'
      ? '准星区格值最高。网格仅覆盖主屏，按 32 × 18 归一化。'
      : '移动图层：每 50ms 采样一次光标位置，反映鼠标移动落点分布。';
  const rangePrefix = state.ranges.mouse === 'session' ? '本次（启动/重置以来）' : state.ranges.mouse === 'week' ? '近 7 天' : '今天';
  const intro = state.empty
    ? '移动一下鼠标。'
    : !data
      ? '正在读取鼠标数据…'
      : `${rangePrefix}点了 ${(summary?.clicks ?? 0).toLocaleString('en-US')} 次，鼠标移动了约 ${(summary?.moveKm ?? 0).toFixed(1)} 公里。`;

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="mouse" aria-label="鼠标查看">
      <header className="g-head">
        <h1>鼠标使用</h1>
        <p>{intro}</p>
      </header>

      <div className="mouse-top">
        <div className="panel grid-panel">
          <div className="ph">
            <span className="ph-title">屏幕网格</span>
            <div className="seg" id="layerSeg" role="group" aria-label="图层">
              {([['clicks', '点击'], ['move', '移动']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  data-v={v}
                  aria-pressed={state.layer === v}
                  onClick={() => {
                    dispatch({ type: 'setLayer', layer: v });
                    dispatch({ type: 'setCell', cell: null });
                  }}
                >{label}</button>
              ))}
            </div>
            <div className="ph-spacer" />
            <span className="ph-meta">主屏 32 × 18</span>
          </div>
          <div className="screenwrap">
            <ScreenGrid
              cells={cells}
              factor={factor}
              layer={state.layer}
              empty={state.empty}
              cell={state.cell}
              onHover={(cell) => dispatch({ type: 'setCell', cell })}
              onSelect={(cell) => dispatch({ type: 'setCell', cell })}
            />
          </div>
          <div className="screen-foot">
            <span id="gridFoot">{gridFoot}</span>
            <span>16:9 虚线为主屏轮廓</span>
          </div>
          <div className="page-mask" id="mouseMask" hidden={!state.empty}>
            <div className="mask-title">移动一下鼠标</div>
            <div className="mask-note">{isTauri ? '数据已清空，点「开始记录」后继续统计。' : '示例数据已清空。'}</div>
            <button className="mask-btn" type="button" onClick={() => dispatch({ type: 'restore' })}>{isTauri ? '开始记录' : '恢复演示数据'}</button>
          </div>
        </div>

        <div className="panel metric-panel">
          <div className="ph">
            <span className="ph-title">指标</span>
            <div className="ph-spacer" />
            <span className="ph-meta" id="metricRange">{data?.rangeLabel ?? '今日'}</span>
          </div>
          <MetricList extra={extra} factor={data?.factor ?? 1} empty={state.empty} />
        </div>
      </div>

      <div className="mouse-bottom">
        <div className="panel mouse-panel">
          <div className="ph"><span className="ph-title">鼠标俯视</span></div>
          <div className="mouseshape">
            <MouseSvg
              extra={extra}
              factor={data?.factor ?? 1}
              empty={state.empty}
            />
          </div>
        </div>

        <div className="panel hotspot-panel">
          <div className="ph">
            <span className="ph-title">点击热点</span>
            <div className="ph-spacer" />
            <span className="ph-meta">按次数排序，前 6 格</span>
          </div>
          <Hotspots
            cells={cells}
            factor={factor}
            layer={state.layer}
            empty={state.empty}
            cell={state.cell}
            onSelect={(cell) => dispatch({ type: 'setCell', cell })}
          />
          <div className="hotspot-note" id="hotspotNote">{hotspotNote}</div>
        </div>
      </div>
    </section>
  );
}
