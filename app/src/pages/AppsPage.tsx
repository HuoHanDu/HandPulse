import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/store';
import { useReducedMotion } from '../app/useReducedMotion';
import { useForegroundEnabled, writeForegroundEnabled } from '../app/foregroundSetting';
import { loadAppDetail, loadAppStats } from '../ipc/client';
import type { AppDetail, AppStat } from '../ipc/types';
import { KeyboardCanvas } from '../keyboard/KeyboardCanvas';
import { Top10List } from '../keyboard/Top10List';

const GAP_LABELS = ['0–40', '40–80', '80–120', '120–200', '200–350', '350–500', '500+'];
const BUTTON_LABELS = ['左键', '右键', '中键', '侧键1', '侧键2'];

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDistance(px: number): string {
  if (px >= 1_000_000) return `${(px / 1_000_000).toFixed(2)} km`;
  if (px >= 1000) return `${(px / 1000).toFixed(1)} k px`;
  return `${Math.round(px)} px`;
}

function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="app-mini-bars">
      {values.map((v, i) => (
        <div className="app-mini-bar" key={labels[i]}>
          <span>{labels[i]}</span>
          <i><b style={{ width: `${Math.max(2, Math.round((v / max) * 100))}%` }} /></i>
          <em className="mono">{v.toLocaleString('en-US')}</em>
        </div>
      ))}
    </div>
  );
}

function AppHabits({ detail }: { detail: AppDetail }) {
  const gapMax = Math.max(1, ...detail.gapHist);
  const adRate = detail.adTotal > 0 ? Math.round((detail.adFast / detail.adTotal) * 100) : 0;
  const pairs = detail.pairs.slice(0, 6);
  return (
    <div className="app-habits">
      <div className="app-habit-col">
        <div className="app-kicker">快速交替 A / D</div>
        <div className="app-habit-big mono">{detail.adFast.toLocaleString('en-US')}<span>次</span></div>
        <div className="app-habit-hint">
          {detail.adTotal > 0 ? `120ms 内 · 共 ${detail.adTotal.toLocaleString('en-US')} 次 · ${adRate}%` : '这个应用还没有 A/D 交替数据'}
        </div>
        <div className="app-meter"><i style={{ width: `${adRate}%` }} /></div>
      </div>
      <div className="app-habit-col app-habit-pairs">
        <div className="app-kicker">高频组合</div>
        {pairs.length ? pairs.map(p => (
          <div className="app-habit-row" key={`${p.a}:${p.b}`}>
            <span>{p.a} + {p.b}</span>
            <i><b style={{ width: `${Math.max(4, Math.round((p.count / pairs[0].count) * 100))}%` }} /></i>
            <em className="mono">{p.count.toLocaleString('en-US')}</em>
          </div>
        )) : <div className="app-empty-line">暂无组合数据</div>}
      </div>
      <div className="app-habit-col">
        <div className="app-kicker">间隔分布</div>
        <div className="app-gap-grid">
          {GAP_LABELS.map((label, i) => (
            <div className="app-gap-cell" key={label} title={`${label}ms`}>
              <span><i style={{ height: `${Math.max(4, Math.round(((detail.gapHist[i] ?? 0) / gapMax) * 100))}%` }} /></span>
              <em>{label}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppsPage({ active }: { active: boolean }) {
  const { state } = useApp();
  const range = state.ranges.apps;
  const enabled = useForegroundEnabled();
  const reduce = useReducedMotion();
  const [apps, setApps] = useState<AppStat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppDetail | null>(null);

  useEffect(() => {
    if (!active || !enabled) return;
    let alive = true;
    const load = () => {
      loadAppStats(range)
        .then(list => {
          if (!alive) return;
          setApps(list);
          setSelected(prev => (prev && list.some(a => a.name === prev)) ? prev : (list[0]?.name ?? null));
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [active, enabled, range]);

  useEffect(() => {
    if (!active || !enabled || !selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    const load = () => {
      loadAppDetail(selected, range)
        .then(d => { if (alive) setDetail(d); })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [active, enabled, range, selected]);

  const keyStats = detail?.keyStats ?? [];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of keyStats) m.set(k.label, k.count);
    return m;
  }, [keyStats]);
  const maxCount = keyStats[0]?.count ?? 0;
  const total = detail?.keys ?? 0;

  if (!enabled) {
    return (
      <section className={'page' + (active ? ' active' : '')} data-page="apps" aria-label="前台应用">
        <header className="g-head">
          <h1>前台应用</h1>
          <p>按应用查看键盘、鼠标和操作习惯；默认关闭。</p>
        </header>
        <div className="panel apps-disabled">
          <div className="apps-disabled-icon">◎</div>
          <h2>还没有开启前台应用统计</h2>
          <p>只记录 exe 名称、前台时长和按键/点击聚合；不读取窗口标题，也不保存输入内容。</p>
          <button
            className="tbtn primary"
            type="button"
            onClick={() => writeForegroundEnabled(true)}
          >开启前台应用统计</button>
          <span className="apps-disabled-note">开启后左侧会出现“前台应用”入口</span>
        </div>
      </section>
    );
  }

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="apps" aria-label="前台应用">
      <header className="g-head">
        <h1>前台应用</h1>
        <p>按前台时长排序。选择应用，查看它在键盘、鼠标和操作习惯上的画像。</p>
      </header>

      <div className="apps-layout">
        <aside className="panel apps-nav">
          <div className="ph">
            <span className="ph-title">应用</span>
            <span className="ph-meta">{apps.length ? `${apps.length} 个` : ''}</span>
          </div>
          <div className="apps-list">
            {apps.length ? apps.map((a, i) => {
              const maxSec = apps[0]?.seconds || 1;
              return (
                <button
                  key={a.name}
                  type="button"
                  className={'apps-item' + (selected === a.name ? ' is-sel' : '')}
                  onClick={() => setSelected(a.name)}
                >
                  <span className="apps-rank mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="apps-name">{a.name}</span>
                  <span className="apps-time mono">{duration(a.seconds)}</span>
                  <span className="apps-bar"><i style={{ width: `${Math.max(2, Math.round((a.seconds / maxSec) * 100))}%` }} /></span>
                </button>
              );
            }) : (
              <div className="apps-list-empty">
                还没有数据。<br />让应用在前台停留几秒，或敲几个键。
              </div>
            )}
          </div>
        </aside>

        <div className="apps-detail">
          {detail ? (
            <>
              <div className="panel app-summary">
                <div className="ph">
                  <span className="ph-title app-detail-title">{detail.name}</span>
                  <span className="ph-meta">{duration(detail.seconds)} 前台</span>
                  <div className="ph-spacer" />
                  <span className="ph-meta">只统计前台时输入</span>
                </div>
                <div className="app-summary-grid">
                  <div><span>按键</span><b className="mono">{detail.keys.toLocaleString('en-US')}</b></div>
                  <div><span>点击</span><b className="mono">{detail.clicks.toLocaleString('en-US')}</b></div>
                  <div><span>滚轮</span><b className="mono">{detail.wheel.toLocaleString('en-US')}</b></div>
                  <div><span>移动</span><b className="mono">{formatDistance(detail.movePx)}</b></div>
                </div>
              </div>

              <div className="apps-mid">
                <div className="panel app-heat">
                  <div className="ph">
                    <span className="ph-title">键盘热力</span>
                    <span className="ph-meta">{(detail.keys ? '按在该应用前台的按键' : '无按键')}</span>
                  </div>
                  <div className="app-kb-stage">
                    <KeyboardCanvas
                      active={active}
                      layout={104}
                      disp="heat"
                      counts={counts}
                      maxCount={maxCount}
                      sel={null}
                      paused={false}
                      empty={!detail.keys}
                      reduce={reduce}
                      minU={20}
                    />
                  </div>
                </div>
              </div>

              <div className="apps-lower">
                <div className="panel app-top10">
                  <div className="ph">
                    <span className="ph-title">Top 10 键位</span>
                    <span className="ph-meta">占比 = 次数 / 该应用按键</span>
                  </div>
                  <Top10List
                    keyStats={keyStats}
                    total={total}
                    sel={null}
                    empty={!detail.keys}
                    viewReset={false}
                    onPick={() => {}}
                  />
                  {!keyStats.length && detail.keys > 0 && (
                    <div className="app-empty-line" style={{ padding: '0 10px 8px' }}>
                      这个应用只有升级后的新数据才会带键位明细。
                    </div>
                  )}
                </div>

                <div className="panel app-mouse">
                  <div className="ph">
                    <span className="ph-title">鼠标使用</span>
                    <span className="ph-meta">{detail.clicks.toLocaleString('en-US')} 次点击</span>
                  </div>
                  <MiniBars values={detail.buttons} labels={BUTTON_LABELS} />
                </div>
              </div>

              <div className="panel app-habits-panel">
                <div className="ph">
                  <span className="ph-title">操作习惯</span>
                  <span className="ph-meta">无序组合 · 不含精确时序</span>
                </div>
                <AppHabits detail={detail} />
              </div>
            </>
          ) : (
            <div className="panel apps-detail-empty">
              {apps.length ? '选择一个应用查看详情' : '还没有可展示的应用数据'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
