import { useEffect, useMemo, useState } from 'react';
import { useApp, type Cell, type Layer } from '../app/store';
import { useReducedMotion } from '../app/useReducedMotion';
import { useForegroundEnabled, writeForegroundEnabled } from '../app/foregroundSetting';
import { loadAppDetail, loadAppStats } from '../ipc/client';
import type { AppDetail, AppStat, LiveAppUsage } from '../ipc/types';
import { useLiveOverlay } from '../state/useLiveOverlay';
import { KeyboardCanvas } from '../keyboard/KeyboardCanvas';
import { Top10List } from '../keyboard/Top10List';
import { KEYS, displayKey } from '../keyboard/layout';
import { ScreenGrid } from '../mouse/ScreenGrid';

const GAP_LABELS = ['0–40', '40–80', '80–120', '120–200', '200–350', '350–500', '500+'];
const BUTTON_LABELS = ['左键', '右键', '中键', '侧键1', '侧键2'];
const PAIR_SEP = '\u0000';

function mouseLabel(token: number): string {
  return token === 104 ? '左键'
    : token === 105 ? '右键'
      : token === 106 ? '中键'
        : token === 107 ? '侧键1'
          : token === 108 ? '侧键2'
            : `#${token}`;
}

function keyLabel(id: number): string {
  if (id >= 104) return mouseLabel(id);
  const raw = KEYS[id]?.label;
  return raw ? displayKey(raw) : `#${id}`;
}

function mergeDetail(base: AppDetail, live: LiveAppUsage | undefined): AppDetail {
  if (!live) return base;
  const seconds = base.seconds + Math.floor(live.ms / 1000);
  const keys = base.keys + live.keys;
  const clicks = base.clicks + live.clicks;
  const wheel = base.wheel + live.wheel;
  const movePx = base.movePx + live.px;
  const buttons = base.buttons.map((n, i) => n + (live.buttons[i] || 0));

  const keyCounts = new Map<number, number>();
  for (const k of base.keyStats) keyCounts.set(k.keyId, k.count);
  for (const [id, count] of live.keyCounts) keyCounts.set(id, (keyCounts.get(id) || 0) + count);
  const keyStats = Array.from(keyCounts.entries())
    .map(([keyId, count]) => ({
      keyId, label: keyLabel(keyId), count,
      ratio: keys ? count / keys : 0,
      holdAvgMs: 0, holdMaxMs: 0, firstTs: 0, lastTs: 0
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const pairMap = new Map<string, { a: string; b: string; count: number; fast: number }>();
  for (const p of base.pairs) {
    pairMap.set(`${p.a}${PAIR_SEP}${p.b}`, { a: p.a, b: p.b, count: p.count, fast: p.fastCount });
  }
  const liveFast = new Map<number, number>();
  for (const [rawKey, count] of live.pairGap) {
    const pair = Math.floor(rawKey / 8);
    const bin = rawKey % 8;
    if (bin <= 2) liveFast.set(pair, (liveFast.get(pair) || 0) + count);
  }
  for (const [pair, count] of live.pair) {
    const a = keyLabel((pair >>> 16) & 0xffff);
    const b = keyLabel(pair & 0xffff);
    const k = `${a}${PAIR_SEP}${b}`;
    const cur = pairMap.get(k) || { a, b, count: 0, fast: 0 };
    cur.count += count;
    cur.fast += liveFast.get(pair) || 0;
    pairMap.set(k, cur);
  }
  const pairs = Array.from(pairMap.values())
    .sort((a, b) => b.count - a.count)
    .map(p => ({ a: p.a, b: p.b, count: p.count, fastCount: p.fast }));

  const gapHist = [...base.gapHist];
  for (const [rawKey, count] of live.pairGap) {
    const bin = rawKey % 8;
    if (bin < gapHist.length) gapHist[bin] += count;
  }
  let adFast = 0;
  let adTotal = 0;
  for (const p of pairs) {
    if ((p.a === 'A' && p.b === 'D') || (p.a === 'D' && p.b === 'A')) {
      adTotal += p.count;
      adFast += p.fastCount;
    }
  }
  const mergeGrid = (baseCells: AppDetail['clickGrid'], liveCells: Array<[number, number]>) => {
    const m = new Map<string, number>();
    for (const c of baseCells) m.set(`${c.x},${c.y}`, c.v);
    for (const [cell, count] of liveCells) {
      const x = cell % 32;
      const y = Math.floor(cell / 32);
      const k = `${x},${y}`;
      m.set(k, (m.get(k) || 0) + count);
    }
    return Array.from(m.entries()).map(([k, v]) => {
      const [x, y] = k.split(',').map(Number);
      return { x, y, v };
    });
  };
  return {
    ...base,
    seconds, keys, clicks, wheel, movePx, buttons,
    keyStats, pairs, gapHist, adFast, adTotal,
    clickGrid: mergeGrid(base.clickGrid, live.clickGrid),
    moveGrid: mergeGrid(base.moveGrid, live.moveGrid)
  };
}

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
  const [followCurrent, setFollowCurrent] = useState(true);
  const [mouseLayer, setMouseLayer] = useState<Layer>('clicks');
  const [mouseCell, setMouseCell] = useState<Cell | null>(null);
  // 只在切换应用/范围时重置实时增量基线，历史基准刷新不再清空。
  const live = useLiveOverlay(selected ? `${selected}:${range}` : null);

  const liveApps = useMemo(() => apps.map(a => {
    const d = live.apps.get(a.name);
    if (!d) return a;
    return {
      ...a,
      seconds: a.seconds + Math.floor(d.ms / 1000),
      keys: a.keys + d.keys,
      clicks: a.clicks + d.clicks,
      wheel: a.wheel + d.wheel,
      movePx: a.movePx + d.px
    };
  }), [apps, live]);

  const viewDetail = useMemo(
    () => (detail ? mergeDetail(detail, live.apps.get(detail.name)) : null),
    [detail, live]
  );

  useEffect(() => {
    if (!followCurrent || !enabled || !live.currentApp) return;
    if (selected === live.currentApp) return;
    setDetail(null);
    setSelected(live.currentApp);
  }, [followCurrent, enabled, live.currentApp, selected]);

  useEffect(() => {
    if (!active || !enabled) return;
    let alive = true;
    loadAppStats(range)
      .then(list => {
        if (!alive) return;
        setApps(list);
        setSelected(prev => (prev && list.some(a => a.name === prev)) ? prev : (list[0]?.name ?? null));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [active, enabled, range]);

  useEffect(() => {
    if (!active || !enabled || !selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    loadAppDetail(selected, range)
      .then(d => { if (alive) setDetail(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [active, enabled, range, selected]);

  const keyStats = viewDetail?.keyStats ?? [];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of keyStats) m.set(k.label, k.count);
    return m;
  }, [keyStats]);
  const maxCount = keyStats[0]?.count ?? 0;
  const total = viewDetail?.keys ?? 0;

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
        {live.currentApp && (
          <div className="apps-now">
            当前前台：<span>{live.currentApp}</span>
            <button
              type="button"
              className={'tbtn' + (followCurrent ? ' is-on' : '')}
              onClick={() => setFollowCurrent(v => !v)}
            >{followCurrent ? '跟随中' : '跟随当前'}</button>
          </div>
        )}
      </header>

      <div className="apps-layout">
        <aside className="panel apps-nav">
          <div className="ph">
            <span className="ph-title">应用</span>
            <span className="ph-meta">{liveApps.length ? `${liveApps.length} 个` : ''}</span>
          </div>
          <div className="apps-list">
            {liveApps.length ? liveApps.map((a, i) => {
              const maxSec = liveApps[0]?.seconds || 1;
              return (
                <button
                  key={a.name}
                  type="button"
                  className={'apps-item' + (selected === a.name ? ' is-sel' : '')}
                  onClick={() => {
                    setFollowCurrent(false);
                    setDetail(null);
                    setSelected(a.name);
                  }}
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
          {viewDetail ? (
            <>
              <div className="panel app-summary">
                <div className="ph">
                  <span className="ph-title app-detail-title">{viewDetail.name}</span>
                  <span className="ph-meta">{duration(viewDetail.seconds)} 前台</span>
                  <div className="ph-spacer" />
                  <span className="ph-meta">只统计前台时输入</span>
                </div>
                <div className="app-summary-grid">
                  <div><span>按键</span><b className="mono">{viewDetail.keys.toLocaleString('en-US')}</b></div>
                  <div><span>点击</span><b className="mono">{viewDetail.clicks.toLocaleString('en-US')}</b></div>
                  <div><span>滚轮</span><b className="mono">{viewDetail.wheel.toLocaleString('en-US')}</b></div>
                  <div><span>移动</span><b className="mono">{formatDistance(viewDetail.movePx)}</b></div>
                </div>
              </div>

              <div className="apps-mid">
                <div className="panel app-heat">
                  <div className="ph">
                    <span className="ph-title">键盘热力</span>
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
                      empty={!viewDetail.keys}
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
                    empty={!viewDetail.keys}
                    viewReset={false}
                    onPick={() => {}}
                  />
                  {!keyStats.length && viewDetail.keys > 0 && (
                    <div className="app-empty-line" style={{ padding: '0 10px 8px' }}>
                      这个应用只有升级后的新数据才会带键位明细。
                    </div>
                  )}
                </div>

                <div className="panel app-mouse">
                  <div className="ph">
                    <span className="ph-title">鼠标使用</span>
                    <div className="seg" role="group" aria-label="鼠标图层">
                      {([['clicks', '点击'], ['move', '移动']] as const).map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={mouseLayer === v}
                          onClick={() => { setMouseLayer(v); setMouseCell(null); }}
                        >{label}</button>
                      ))}
                    </div>
                    <div className="ph-spacer" />
                    <span className="ph-meta">窗口内相对位置</span>
                  </div>
                  <div className="app-mouse-body">
                    <div className="app-mouse-grid">
                      <ScreenGrid
                        cells={mouseLayer === 'clicks' ? viewDetail.clickGrid : viewDetail.moveGrid}
                        factor={1}
                        layer={mouseLayer}
                        empty={false}
                        cell={mouseCell}
                        onHover={setMouseCell}
                        onSelect={setMouseCell}
                      />
                    </div>
                    <div className="app-mouse-side">
                      <MiniBars values={viewDetail.buttons} labels={BUTTON_LABELS} />
                      <div className="app-mouse-cell">
                        {mouseCell
                          ? `格 ${mouseCell.x},${mouseCell.y} · ${mouseCell.v} 次`
                          : '点击/移动到格子上查看数值'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel app-habits-panel">
                <div className="ph">
                  <span className="ph-title">操作习惯</span>
                  <span className="ph-meta">无序组合</span>
                </div>
                <AppHabits detail={viewDetail} />
              </div>
            </>
          ) : (
            <div className="panel apps-detail-empty">
              {liveApps.length ? '选择一个应用查看详情' : '还没有可展示的应用数据'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}


