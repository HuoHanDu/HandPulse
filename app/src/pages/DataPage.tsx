import { useEffect, useState } from 'react';
import { useApp } from '../app/store';
import {
  getCustomDetail, getCustomKeyStats, getCustomMouseStats, getCustomPadStats
} from '../ipc/client';
import { DetailTable } from '../charts/DetailTable';
import type { DetailPage, KeyStat, MouseStats, PadStats } from '../ipc/types';

interface Props {
  active: boolean;
}

type Tab = 'overview' | 'keyboard' | 'mouse' | 'gamepad';

const TABS: Array<[Tab, string]> = [
  ['overview', '总览'],
  ['keyboard', '键盘'],
  ['mouse', '鼠标'],
  ['gamepad', '手柄']
];

function toInput(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function rangeSeconds(start: string, end: string): [number, number] | null {
  const startTs = Math.floor(new Date(start).getTime() / 1000);
  const endTs = Math.floor(new Date(end).getTime() / 1000) + 60;
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return null;
  return [startTs, endTs];
}

const MOUSE_ROWS: Array<[keyof MouseStats['clicks'] | 'wheelUp' | 'wheelDown' | 'moveKm', string]> = [
  ['left', '左键'], ['right', '右键'], ['middle', '中键'], ['side1', '侧键 1'], ['side2', '侧键 2'],
  ['wheelUp', '滚轮上'], ['wheelDown', '滚轮下'], ['moveKm', '移动距离 (km)']
];

export function DataPage({ active }: Props) {
  const { dispatch } = useApp();
  const today = startOfToday();
  const [start, setStart] = useState(toInput(today));
  const [end, setEnd] = useState(toInput(new Date(today.getTime() + 86400000 - 60000)));
  const [tab, setTab] = useState<Tab>('overview');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<DetailPage | null>(null);
  const [keys, setKeys] = useState<KeyStat[]>([]);
  const [mouse, setMouse] = useState<MouseStats | null>(null);
  const [pad, setPad] = useState<PadStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    const seconds = rangeSeconds(start, end);
    if (!seconds) {
      setError('结束时间必须晚于开始时间。');
      return;
    }
    let alive = true;
    setError('');
    setLoading(true);
    const [startTs, endTs] = seconds;
    const run = async () => {
      try {
        if (tab === 'overview') {
          const next = await getCustomDetail(startTs, endTs, page);
          if (alive) setDetail(next);
        } else if (tab === 'keyboard') {
          const next = await getCustomKeyStats(startTs, endTs);
          if (alive) setKeys(next);
        } else if (tab === 'mouse') {
          const next = await getCustomMouseStats(startTs, endTs);
          if (alive) setMouse(next);
        } else {
          const next = await getCustomPadStats(startTs, endTs);
          if (alive) setPad(next);
        }
      } catch (err) {
        if (alive) setError('读取失败：' + String(err));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [active, start, end, tab, page]);

  const setQuick = (kind: 'today' | 'yesterday' | 'week' | 'month') => {
    const now = new Date();
    const from = startOfToday();
    let to = now;
    if (kind === 'yesterday') {
      from.setDate(from.getDate() - 1);
      to = new Date(startOfToday().getTime() - 60000);
    } else if (kind === 'week') {
      from.setDate(from.getDate() - 6);
    } else if (kind === 'month') {
      from.setDate(from.getDate() - 29);
    }
    setStart(toInput(from));
    setEnd(toInput(to));
    setPage(0);
  };

  const pages = Math.max(1, Math.ceil((detail?.total ?? 0) / (detail?.pageSize ?? 50)));
  const keyTotal = keys.reduce((a, k) => a + k.count, 0);
  const padTotal = pad?.total ?? 0;

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="data" aria-label="数据浏览">
      <header className="g-head">
        <h1>数据浏览</h1>
        <p>按自己选择的时间范围查看已落盘的记录；结束时间包含所选分钟。</p>
      </header>

      <div className="panel data-filter">
        <div className="data-filter-row">
          <label className="data-field">
            <span>开始</span>
            <input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setPage(0); }} />
          </label>
          <label className="data-field">
            <span>结束</span>
            <input type="datetime-local" value={end} onChange={(e) => { setEnd(e.target.value); setPage(0); }} />
          </label>
          <div className="data-quick">
            <button className="tbtn" type="button" onClick={() => setQuick('today')}>今天</button>
            <button className="tbtn" type="button" onClick={() => setQuick('yesterday')}>昨天</button>
            <button className="tbtn" type="button" onClick={() => setQuick('week')}>近 7 天</button>
            <button className="tbtn" type="button" onClick={() => setQuick('month')}>近 30 天</button>
            <button className="tbtn primary" type="button" onClick={() => dispatch({ type: 'toast', message: '已按当前范围刷新。' })}>查询</button>
          </div>
        </div>
        <div className="data-tabs" role="tablist" aria-label="数据类型">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'is-active' : ''}
              onClick={() => { setTab(value); setPage(0); }}
            >{label}</button>
          ))}
          <span className="data-tabs-meta">{loading ? '读取中…' : (tab === 'overview' ? `共 ${(detail?.total ?? 0).toLocaleString('en-US')} 行` : '')}</span>
        </div>
        {error ? <div className="data-error">{error}</div> : null}
      </div>

      {tab === 'overview' && (
        <div className="panel data-table">
          <div className="t-head"><span>时间</span><span>动作数</span><span>键次数</span><span>点击</span><span>移动 (cm)</span></div>
          <div className="tablewrap">
            <DetailTable page={detail} />
            {!loading && detail && detail.rows.length === 0 ? <div className="data-empty">这个范围内没有记录。</div> : null}
          </div>
          <div className="pager">
            <button className="pg-btn" type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>上一页</button>
            <span className="pg-cur mono">第 {page + 1} / {pages} 页</span>
            <button className="pg-btn" type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>下一页</button>
            <span className="pg-spacer" />
            <span>{detail?.granLabel ?? '每桶 60 秒'}</span>
          </div>
        </div>
      )}

      {tab === 'keyboard' && (
        <div className="panel data-table">
          <div className="t-head data-key-head"><span>键位</span><span>次数</span><span>占比</span><span>平均按住</span><span>最长按住</span></div>
          <div className="tablewrap">
            {keys.filter((k) => k.count > 0).map((k) => (
              <div className="t-row data-key-row" key={k.keyId}>
                <span className="t-time">{k.label}</span>
                <span>{k.count.toLocaleString('en-US')}</span>
                <span>{(k.ratio * 100).toFixed(1)}%</span>
                <span>{k.holdAvgMs} ms</span>
                <span>{k.holdMaxMs} ms</span>
              </div>
            ))}
            {!loading && keyTotal === 0 ? <div className="data-empty">这个范围内没有键盘记录。</div> : null}
          </div>
          <div className="pager"><span className="pg-spacer" />共 {keyTotal.toLocaleString('en-US')} 次按键</div>
        </div>
      )}

      {tab === 'mouse' && (
        <div className="panel data-metrics">
          <div className="data-metric-grid">
            {mouse && MOUSE_ROWS.map(([key, label]) => {
              const value = key === 'wheelUp'
                ? mouse.wheel[0]
                : key === 'wheelDown'
                  ? mouse.wheel[1]
                  : key === 'moveKm'
                    ? mouse.moveKm.toFixed(1)
                    : mouse.clicks[key];
              return (
                <div className="data-metric" key={key}>
                  <span>{label}</span>
                  <b className="mono">{typeof value === 'number' ? value.toLocaleString('en-US') : value}</b>
                </div>
              );
            })}
          </div>
          {!loading && !mouse?.clicks.total && !mouse?.moveKm ? <div className="data-empty">这个范围内没有鼠标记录。</div> : null}
        </div>
      )}

      {tab === 'gamepad' && (
        <div className="panel data-table">
          <div className="t-head data-pad-head"><span>按键</span><span>次数</span><span>占比</span><span>索引</span><span /></div>
          <div className="tablewrap">
            {pad?.buttons.map((b) => (
              <div className="t-row data-pad-row" key={b.index}>
                <span className="t-time">{b.label}</span>
                <span>{b.count.toLocaleString('en-US')}</span>
                <span>{padTotal ? (b.count / padTotal * 100).toFixed(1) + '%' : '0.0%'}</span>
                <span className="mono">{b.index}</span>
                <span />
              </div>
            ))}
            {!loading && padTotal === 0 ? (
              <div className="data-empty">这个范围内没有手柄记录。手柄按钮需要由新版采集线程写入；当前如果没有历史数据，请在手柄适配页确认按键能被识别。</div>
            ) : null}
          </div>
          <div className="pager"><span className="pg-spacer" />共 {padTotal.toLocaleString('en-US')} 次手柄按键</div>
        </div>
      )}
    </section>
  );
}
