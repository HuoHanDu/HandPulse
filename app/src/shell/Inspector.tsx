import type { ReactNode } from 'react';
import { useApp } from '../app/store';
import { HP, LEVELS } from '../mock/mock';
import { displayKey, keyPos } from '../keyboard/layout';
import { getSummary, loadKeyboard, loadMouse, loadStats } from '../ipc/client';
import { usePageData } from '../state/usePageData';
import type { KeyStat } from '../ipc/types';

function nf(n: number) { return n.toLocaleString('en-US'); }
function pf(v: number) { return (v * 100).toFixed(1) + '%'; }
function clk(m: number) { return HP.fmt.min(m); }

function Kv({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <b className="mono">{value}{hint ? <em>{hint}</em> : null}</b>
    </div>
  );
}

function levelOf(count: number, max: number): number {
  if (!count || !max) return 0;
  const r = count / max;
  if (r > 0.75) return 5;
  if (r > 0.45) return 4;
  if (r > 0.2) return 3;
  if (r > 0.05) return 2;
  return 1;
}

function zoneOf(x: number, y: number): string {
  const nx = (x + 0.5) / 32, ny = (y + 0.5) / 18;
  if (Math.abs(nx - 0.52) < 0.13 && Math.abs(ny - 0.62) < 0.15) return '准星区';
  if (nx > 0.75 && ny < 0.26) return '小地图';
  if (nx < 0.17 && ny < 0.19) return '菜单';
  return '其他区';
}

export function Inspector() {
  const { state, dispatch } = useApp();
  const kb = usePageData(`keyboard:${state.ranges.keyboard}`, () => loadKeyboard(state.ranges.keyboard));
  const mouse = usePageData(`mouse:${state.ranges.mouse}`, () => loadMouse(state.ranges.mouse));
  const stats = usePageData(`stats:${state.ranges.stats}`, () => loadStats(state.ranges.stats));
  const today = usePageData('summary:today', () => getSummary('today'));

  const showKey = state.route === 'keyboard' && state.sel && !state.empty && !state.viewReset;
  const sub = showKey ? '键位 · ' + state.sel : (state.route === 'keyboard' ? '键位' : state.route === 'mouse' ? '点击分布' : state.route === 'stats' ? '图表摘要' : '采集与存储');

  let body: ReactNode = null;

  if (state.route === 'keyboard') {
    if (state.empty || state.viewReset) {
      body = (
        <div className="insp-empty">
          <b>没有可展示的键位证据。</b><br />当前视图已被清空，历史数据未受影响。刷新页面或点「恢复演示数据」可回到示例。
        </div>
      );
    } else {
      const label = state.hover || state.sel;
      const map = new Map<string, KeyStat>();
      (kb?.keyStats ?? []).forEach(s => map.set(s.label, s));
      const maxCount = kb?.keyStats[0]?.count ?? 0;
      const total = kb?.total ?? 0;
      if (!label) {
        body = (
          <>
            <div className="insp-empty">
              <b>选一个键，查看它的全部证据。</b><br />悬停预览，点击固定，ESC 关闭。键盘上显示的是今日累计次数映射的 6 级热力。
            </div>
            <div className="insp-sec">
              <div className="sec-head">今日总览</div>
              <div className="rows">
                <Kv label="按键次数" value={nf(today?.keys ?? 0)} />
                <Kv label="点击次数" value={nf(today?.clicks ?? 0)} />
                <Kv label="动作合计" value={nf(today?.actions ?? 0)} />
                <Kv label="键位数量" value="104" />
              </div>
            </div>
          </>
        );
      } else {
        const stat = map.get(label);
        const cnt = stat?.count ?? 0;
        const ratio = total ? cnt / total : 0;
        const lv = levelOf(cnt, maxCount);
        const L = LEVELS[lv];
        const pos = keyPos(label);
        const times = stat ? [clk(stat.firstTs), clk(stat.lastTs)] : ['00:00', '00:00'];
        const rank = (kb?.keyStats.findIndex(s => s.label === label) ?? -1) + 1;
        const name = displayKey(label);
        const rangeKey = state.ranges.keyboard;
        const rt = rangeKey === 'session' ? '本次（最近 30 分钟）' : rangeKey === 'week' ? '7 天' : '今日';
        const rankText = rangeKey === 'today' ? '按次数第 ' + rank + ' 位' : rt + ' 读数';
        body = (
          <>
            <div className="hero">
              <span className="hero-key mono">{name}</span>
              <div className="hero-meta">
                <span className="hero-name">{label} 键</span>
                <span className="hero-rank">{rankText}</span>
              </div>
            </div>
            <div className="hero-meter"><i style={{ width: (ratio * 100).toFixed(1) + '%' }} /></div>
            <div className="hero-note">
              <span className="swatch-line" style={{ background: L.c }} />热力 L{lv}，占全部按键 {pf(ratio)}
            </div>
            <div className="rows">
              <Kv label="次数" value={nf(cnt)} />
              <Kv label="占比" value={pf(ratio)} />
              <Kv label="平均按住" value={nf(stat?.holdAvgMs ?? 0) + ' ms'} hint={label === 'A' ? undefined : '全局'} />
              <Kv label="最长按住" value={nf(stat?.holdMaxMs ?? 0) + ' ms'} hint={label === 'A' ? undefined : 'A 键'} />
              <Kv label="首次出现" value={times[0]} />
              <Kv label="最近出现" value={times[1]} />
              <Kv label="物理位置" value={'第 ' + pos.row + ' 行 / 第 ' + pos.col + ' 列'} />
            </div>
            <p className="insp-p">长按只计 1 次，松开再按才 +1。修饰键左右分开计数，和输入内容无关。</p>
            <div className="insp-rule">范围只改读数，键间相对热度沿用今日分布。ESC 关闭详情。</div>
          </>
        );
      }
    }
  } else if (state.route === 'mouse') {
    const f = state.empty ? 0 : (state.layer === 'clicks' ? (mouse?.factor ?? 1) : 1);
    const src = state.layer === 'clicks' ? (mouse?.grid ?? []) : (mouse?.moveGrid ?? []);
    const c = mouse?.extra.clicks ?? { left: 0, right: 0, middle: 0, side1: 0, side2: 0, total: 0 };
    const layerTotal = src.reduce((a, g) => a + g.v, 0);
    const cell = state.cell || { x: 16, y: 10, v: mouse?.gridMax ?? 0 };
    let cellRaw = 0;
    src.forEach(g => { if (g.x === cell.x && g.y === cell.y) cellRaw = g.v; });
    const zone = zoneOf(cell.x, cell.y);
    const cellVal = Math.round(cellRaw * f);
    const parts: Array<[string, number, string]> = [
      ['左键', c.left, '#4c8dff'], ['右键', c.right, '#2f5f96'],
      ['中键', c.middle, '#6f8aa6'], ['侧键', c.side1 + c.side2, '#3a4654']
    ];
    body = (
      <>
        <div className="insp-sec">
          <div className="sec-head">点击构成</div>
          <div className="stackbar">
            {parts.map(p => <i key={p[0]} style={{ width: (p[1] / c.total * 100).toFixed(2) + '%', background: p[2] }} />)}
          </div>
          <div className="rows">
            {parts.map(p => (
              <div className="row" key={p[0]}>
                <span><span className="swatch-line" style={{ background: p[2] }} />{p[0]}</span>
                <b className="mono">{nf(Math.round(p[1] * f))}<em>{pf(p[1] / c.total)}</em></b>
              </div>
            ))}
          </div>
        </div>
        <div className="insp-sec">
          <div className="sec-head">选中格（{state.layer === 'clicks' ? '点击' : '移动'}图层）</div>
          <div className="zone-hero mono">({cell.x}, {cell.y}) <span className="zone-num">{nf(cellVal)}</span></div>
          <div className="rows">
            <Kv label="区域" value={zone} />
            <Kv label={state.layer === 'clicks' ? '占全部点击' : '占移动点数'} value={pf(layerTotal ? cellRaw / layerTotal : 0)} />
            <Kv label="滚轮" value={'↑' + nf(Math.round((mouse?.extra.wheel[0] ?? 0) * f)) + ' / ↓' + nf(Math.round((mouse?.extra.wheel[1] ?? 0) * f))} />
            <Kv label="移动距离" value={'≈ ' + ((mouse?.extra.moveKm ?? 0) * f).toFixed(1) + ' km'} />
          </div>
        </div>
        <p className="insp-p">
          {state.empty
            ? '示例数据已清空。'
            : state.layer === 'clicks'
              ? '范围换算：本次取最近 30 分钟，7 天按点击总量等比折算；网格只覆盖主屏。'
              : '移动图层为原型近似：按点击热力平滑估算，正式版由采样点单独统计。'}
        </p>
      </>
    );
  } else if (state.route === 'stats') {
    const r = state.ranges.stats;
    const view = r === 'today' ? '今日 · 分钟桶 1,304 行' : r === 'week' ? '7 天 · 小时桶 168 行' : '30 天 · 天桶 30 行';
    body = (
      <>
        <div className="insp-sec">
          <div className="sec-head">图表摘要</div>
          <p className="insp-p" style={{ padding: 0 }}>{state.empty ? '该时段无记录。' : (stats?.line.note ?? '')}</p>
        </div>
        <div className="insp-sec">
          <div className="sec-head">关键读数</div>
          <div className="rows">
            <Kv label="日总动作" value={nf(today?.actions ?? 0)} />
            <Kv label="今日按键" value={nf(today?.keys ?? 0)} />
            <Kv label="今日点击" value={nf(today?.clicks ?? 0)} />
            <Kv label="峰值" value={HP.peak.value + ' APM'} />
            <Kv label="峰值时刻" value={HP.peak.label} />
          </div>
        </div>
        <div className="insp-sec">
          <div className="sec-head">当前视图</div>
          <div className="rows">
            <Kv label="范围" value={view} />
            <Kv label="粒度" value={r === 'today' ? '1 分钟' : r === 'week' ? '1 小时' : '1 天'} />
          </div>
          <div style={{ paddingTop: 10 }}>
            <button
              className="tbtn"
              id="inspExport"
              type="button"
              onClick={() => dispatch({ type: 'toast', message: 'CSV 导出为原型占位，正式版导出当前范围全部行。' })}
            >导出当前范围 CSV</button>
          </div>
        </div>
        <div className="insp-rule">对数轴的分布图在左下角标注；峰值只标一个，避免噪音。</div>
      </>
    );
  } else {
    const buckets = state.ranges.keyboard === 'session' ? 30 : state.ranges.keyboard === 'week' ? 128 : 1304;
    body = (
      <>
        <div className="insp-sec">
          <div className="sec-head">采集内核</div>
          <div className="rows">
            <Kv label="HandPulse Core" value={state.paused ? '已暂停' : '运行中'} />
            <Kv label="采样间隔" value="100 ms" />
            <Kv label="写入粒度" value={state.granularity + ' 秒'} />
            <Kv label="开机自启" value={state.autoStart ? '开' : '关'} />
          </div>
        </div>
        <div className="insp-sec">
          <div className="sec-head">存储</div>
          <div className="rows">
            <Kv label="数据库" value="data.db" />
            <Kv label="保留" value={state.retention + ' 天'} />
            <Kv label="当前范围桶数" value={nf(buckets)} />
            <Kv label="今日动作" value={nf(today?.actions ?? 0)} />
          </div>
        </div>
        <p className="insp-p">关闭总开关会立即停止写入；清空需要输入 DELETE，删除后不可恢复。</p>
      </>
    );
  }

  return (
    <aside className="insp" id="insp" aria-label="检查器">
      <div className="insp-head">
        <span className="insp-title">检查器</span>
        <span className="insp-sub" id="inspSub">{sub}</span>
        <button
          className="insp-x"
          id="inspX"
          type="button"
          aria-label="关闭详情"
          hidden={!showKey}
          onClick={() => dispatch({ type: 'select', label: null })}
        >×</button>
      </div>
      <div className="insp-body" id="inspBody">{body}</div>
    </aside>
  );
}
