import { useEffect, useState } from 'react';
import { useApp } from '../app/store';
import { getCustomDetail } from '../ipc/client';
import { DetailTable } from '../charts/DetailTable';
import type { DetailPage } from '../ipc/types';

interface Props {
  active: boolean;
}

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

export function DataPage({ active }: Props) {
  const { dispatch } = useApp();
  const today = startOfToday();
  const [start, setStart] = useState(toInput(today));
  const [end, setEnd] = useState(toInput(new Date(today.getTime() + 86400000 - 60000)));
  const [page, setPage] = useState(0);
  const [data, setData] = useState<DetailPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = () => {
    const startTs = Math.floor(new Date(start).getTime() / 1000);
    // 结束分钟也算进去：SQL 使用 [start, end) 开区间。
    const endTs = Math.floor(new Date(end).getTime() / 1000) + 60;
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
      setError('结束时间必须晚于开始时间。');
      setData(null);
      return;
    }
    setError('');
    setLoading(true);
    getCustomDetail(startTs, endTs, page)
      .then((next) => setData(next))
      .catch((err) => {
        setError('读取失败：' + String(err));
        setData(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (active) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, start, end, page]);

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

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 50)));

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="data" aria-label="数据浏览">
      <header className="g-head">
        <h1>数据浏览</h1>
        <p>按自己选择的时间范围查看已落盘的分钟记录；结束时间包含所选分钟。</p>
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
            <button className="tbtn primary" type="button" onClick={reload}>查询</button>
          </div>
        </div>
        <div className="data-meta">
          <span>{loading ? '读取中…' : `共 ${total.toLocaleString('en-US')} 行`}</span>
          <span>{data?.granLabel ?? '每桶 60 秒'}</span>
          <button
            className="tbtn"
            type="button"
            onClick={() => dispatch({ type: 'toast', message: '数据浏览只读，不会修改数据库。' })}
          >只读</button>
        </div>
        {error ? <div className="data-error">{error}</div> : null}
      </div>

      <div className="panel data-table">
        <div className="t-head"><span>时间</span><span>动作数</span><span>键次数</span><span>点击</span><span>移动 (cm)</span></div>
        <div className="tablewrap">
          <DetailTable page={data} />
          {!loading && data && data.rows.length === 0 ? <div className="data-empty">这个范围内没有记录。</div> : null}
        </div>
        <div className="pager">
          <button className="pg-btn" type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>上一页</button>
          <span className="pg-cur mono">第 {page + 1} / {pages} 页</span>
          <button className="pg-btn" type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>下一页</button>
          <span className="pg-spacer" />
          <span>范围由你决定，数据来自本机 SQLite</span>
        </div>
      </div>
    </section>
  );
}
