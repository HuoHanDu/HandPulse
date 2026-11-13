import { useEffect, useState } from 'react';
import { useApp } from '../app/store';
import { getDetailPage, isTauri, loadAppStats, loadStats } from '../ipc/client';
import { usePageData } from '../state/usePageData';
import { LineChart } from '../charts/LineChart';
import { Histogram } from '../charts/Histogram';
import { WeekHeatmap } from '../charts/WeekHeatmap';
import { CalendarHeatmap } from '../charts/CalendarHeatmap';
import { MonthHeatmap } from '../charts/MonthHeatmap';
import { DetailTable } from '../charts/DetailTable';
import type { DetailPage, HistDim, HeatType } from '../ipc/types';

const HIST_OPTS: Array<[HistDim, string]> = [['top20', 'Top 20'], ['hours', '时段'], ['gaps', '间隔']];
const HEAT_OPTS: Array<[HeatType, string]> = [['week', '7×24'], ['cal', '日历'], ['month', '月历']];

interface Props {
  active: boolean;
}

export function StatsPage({ active }: Props) {
  const { state, dispatch } = useApp();
  const range = state.ranges.stats;
  const { data } = usePageData(`stats:${range}`, () => loadStats(range));
  const { data: detail } = usePageData(`detail:${range}:${state.page}`, () => getDetailPage(range, state.page));
  const { data: apps } = usePageData(`apps:${range}`, () => loadAppStats(range));

  const [lineReadout, setLineReadout] = useState('');
  const [histReadout, setHistReadout] = useState('');
  const [heatReadout, setHeatReadout] = useState('');

  const line = data?.line;
  const hist = data?.histograms[state.hist];
  const heat = data?.heatmaps[state.heat];

  useEffect(() => {
    if (line) setLineReadout(line.peakText);
  }, [line]);

  useEffect(() => {
    if (hist) setHistReadout(state.empty ? '该时段无记录' : hist.readout);
  }, [hist, state.empty]);

  useEffect(() => {
    if (heat) setHeatReadout(state.empty ? '无记录' : heat.readout);
  }, [heat, state.empty]);

  const pages = Math.max(1, Math.ceil((detail?.total ?? 0) / 50));
  const pageIndex = detail?.page ?? state.page;
  const countText = state.empty
    ? '无记录'
    : detail
      ? `共 ${detail.total.toLocaleString('en-US')} 行，每页 50 行`
      : '';
  const rangePrefix = range === 'week' ? '近 7 天' : range === 'month' ? '近 30 天' : '今日';
  const unitText = range === 'week' ? '次/时' : range === 'month' ? '次/天' : '次/分';
  const peakTail = line?.peakText.includes('，') ? line.peakText.split('，').slice(1).join('，') : '';
  const intro = state.empty
    ? '还没有数据，先在键盘/鼠标页敲几下。'
    : !line
      ? '正在读取统计数据…'
      : `${rangePrefix}峰值 ${line.peak.val.toLocaleString('en-US')} ${unitText}，出现在 ${peakTail}。`;

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="stats" aria-label="数据展示">
      <header className="g-head">
        <h1>数据展示</h1>
        <p>{intro}</p>
      </header>

      <div className="panel stat-top">
        <div className="ph">
          <span className="ph-title">输入强度</span>
          <span className="ph-meta" id="lineUnit">{line?.unit ?? '次/分'}</span>
          <div className="ph-spacer" />
          <span className="line-readout mono" id="lineReadout">{lineReadout}</span>
        </div>
        <div className="chart" id="lineChart">
          {line && <LineChart series={line} onReadout={setLineReadout} />}
        </div>
        <div className="chart-note" id="lineNote">{state.empty ? '该时段无记录。' : (line?.note ?? '')}</div>
      </div>

      <div className="stat-mid">
        <div className="panel">
          <div className="ph">
            <span className="ph-title">分布</span>
            <div className="seg" id="histSeg" role="group" aria-label="直方图视图">
              {HIST_OPTS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  data-v={v}
                  aria-pressed={state.hist === v}
                  onClick={() => dispatch({ type: 'setHist', hist: v })}
                >{label}</button>
              ))}
            </div>
            <div className="ph-spacer" />
            <span className="ph-meta" id="histReadout">{histReadout}</span>
          </div>
          <div className="chart" id="histChart">
            {hist && <Histogram chart={hist} empty={state.empty} onReadout={setHistReadout} />}
          </div>
        </div>

        <div className="panel">
          <div className="ph">
            <span className="ph-title">使用热力</span>
            <div className="seg" id="heatSeg" role="group" aria-label="热力图视图">
              {HEAT_OPTS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  data-v={v}
                  aria-pressed={state.heat === v}
                  onClick={() => dispatch({ type: 'setHeat', heat: v })}
                >{label}</button>
              ))}
            </div>
            <div className="ph-spacer" />
            <span className="ph-meta" id="heatReadout">{heatReadout}</span>
          </div>
          <div className="chart" id="heatChart">
            {heat && state.heat === 'week' && <WeekHeatmap chart={heat} empty={state.empty} onReadout={setHeatReadout} />}
            {heat && state.heat === 'cal' && <CalendarHeatmap chart={heat} empty={state.empty} onReadout={setHeatReadout} />}
            {heat && state.heat === 'month' && <MonthHeatmap chart={heat} empty={state.empty} onReadout={setHeatReadout} />}
          </div>
        </div>
      </div>

      <div className="panel app-panel">
        <div className="ph">
          <span className="ph-title">前台应用</span>
          <span className="ph-meta">只记录 exe 名称与聚合操作量</span>
          <div className="ph-spacer" />
          <span className="ph-meta">{apps?.length ? `Top ${apps.length}` : ''}</span>
        </div>
        {apps?.length ? (
          <div className="app-list">
            <div className="app-head"><span>程序</span><span>前台时长</span><span>按键</span><span>点击</span></div>
            {apps.slice(0, 8).map((a) => {
              const h = Math.floor(a.seconds / 3600);
              const m = Math.floor((a.seconds % 3600) / 60);
              const duration = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${a.seconds}s`;
              return (
                <div className="app-row" key={a.name}>
                  <span className="app-name">{a.name}</span>
                  <span className="mono">{duration}</span>
                  <span className="mono">{a.keys.toLocaleString('en-US')}</span>
                  <span className="mono">{a.clicks.toLocaleString('en-US')}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="app-empty">还没有前台应用数据。到设置里开启“前台应用统计”后，只记录程序名和聚合操作量。</div>
        )}
      </div>

      <div className="panel stat-table">
        <div className="ph">
          <span className="ph-title">明细</span>
          <span className="ph-meta" id="tableGran">{detail?.granLabel ?? (range === 'week' ? '每桶 1 小时' : range === 'month' ? '每桶 1 天' : '每桶 60 秒')}</span>
          <div className="ph-spacer" />
          <span className="ph-meta" id="tableCount">{countText}</span>
          <button
            className="tbtn"
            id="exportTable"
            type="button"
            disabled
            title="M4 再实现真实导出"
          >导出 CSV <span className="m4badge">M4</span></button>
        </div>
        <div className="tablewrap">
          <div className="t-head"><span>时间</span><span>动作数</span><span>键次数</span><span>点击</span><span>移动 (cm)</span></div>
          <DetailTable page={detail as DetailPage | null} />
        </div>
        <div className="pager" id="pager">
          <button
            className="pg-btn"
            data-pg="-1"
            type="button"
            disabled={pageIndex <= 0}
            onClick={() => dispatch({ type: 'setPage', page: Math.max(0, pageIndex - 1) })}
          >上一页</button>
          <span className="pg-cur mono">第 {pageIndex + 1} / {pages} 页</span>
          <button
            className="pg-btn"
            data-pg="1"
            type="button"
            disabled={pageIndex >= pages - 1}
            onClick={() => dispatch({ type: 'setPage', page: Math.min(pages - 1, pageIndex + 1) })}
          >下一页</button>
          <span className="pg-spacer" />
          <span>{state.empty ? '—' : '导出范围为当前筛选的全部行'}</span>
        </div>
      </div>

      <div className="page-mask" id="statsMask" hidden={!state.empty}>
        <div className="mask-title">还没有数据，先在键盘/鼠标页敲几下</div>
        <div className="mask-note">{isTauri ? '数据已清空，点「开始记录」后继续统计。' : '示例数据已清空。'}</div>
        <button className="mask-btn" type="button" onClick={() => dispatch({ type: 'restore' })}>{isTauri ? '开始记录' : '恢复演示数据'}</button>
      </div>
    </section>
  );
}
