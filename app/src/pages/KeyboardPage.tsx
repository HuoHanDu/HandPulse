import { useMemo, useReducer, useRef, useEffect, useState } from 'react';
import { useApp } from '../app/store';
import { useReducedMotion } from '../app/useReducedMotion';
import { isTauri, loadKeyboard, loadPatterns } from '../ipc/client';
import { usePageData } from '../state/usePageData';
import { useLiveOverlay } from '../state/useLiveOverlay';
import { KeyboardCanvas, type KeyboardHandle } from '../keyboard/KeyboardCanvas';
import { displayKey } from '../keyboard/layout';
import { Top10List } from '../keyboard/Top10List';
import { KeyboardPatterns } from '../keyboard/KeyboardPatterns';
import { LegendChips } from '../keyboard/LegendChips';
import type { PatternStats } from '../ipc/types';

function pad2(n: number) {
  return (n < 10 ? '0' : '') + n;
}

interface Props {
  active: boolean;
}

export function KeyboardPage({ active }: Props) {
  const { state, dispatch } = useApp();
  const range = state.ranges.keyboard;
  const { data } = usePageData(`keyboard:${range}`, () => loadKeyboard(range));
  const overlay = useLiveOverlay(data);  const keyStats = useMemo(() => {
    const base = data?.keyStats ?? [];
    if (!overlay.keysTotal) return base;
    return base
      .map(s => ({ ...s, count: s.count + (overlay.keyCount.get(s.keyId) || 0) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [data, overlay]);
  const kbRef = useRef<KeyboardHandle>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const reduceMotion = useReducedMotion();
  const [bottomTab, setBottomTab] = useState<'top10' | 'patterns'>('top10');
  const [patterns, setPatterns] = useState<PatternStats | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const refresh = () => {
      loadPatterns(range)
        .then((data) => { if (alive) setPatterns(data); })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active, range]);
  const patternsOverlay = useLiveOverlay(patterns);

  useEffect(() => {
    if (!state.paused) return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [state.paused]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    keyStats.forEach(stat => map.set(stat.label, stat.count));
    return map;
  }, [keyStats]);

  const maxCount = state.empty || state.viewReset ? 0 : (keyStats[0]?.count ?? 0);
  const total = (data?.total ?? 0) + overlay.keysTotal;
  const rangeLabel = data?.rangeLabel ?? '今日';
  const maskShown = state.paused || state.empty;
  const elapsed = state.paused ? Math.floor((Date.now() - state.pausedAt) / 1000) : 0;
  const pauseText = `已暂停 ${Math.floor(elapsed / 60)}:${pad2(elapsed % 60)}，恢复后继续写入。`;
  const topKey = keyStats[0];
  const rangePrefix = state.ranges.keyboard === 'session' ? '本次（启动/重置以来）' : state.ranges.keyboard === 'week' ? '近 7 天' : '今天';
  const intro = state.empty
    ? '还没有记录到按键 —— 敲几个键试试。'
    : !data
      ? '正在读取按键数据…'
      : `${rangePrefix}按了 ${data.total.toLocaleString('en-US')} 次键。${topKey ? displayKey(topKey.label) : '—'} 出现最多，${topKey ? topKey.count.toLocaleString('en-US') : '0'} 次。`;

  const pick = (label: string, pulse = false) => {
    dispatch({ type: 'select', label });
    if (pulse) kbRef.current?.pulse(label);
  };

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="keyboard" aria-label="键盘查看">
      <header className="g-head">
        <h1>键盘使用</h1>
        <p>{intro}</p>
      </header>

      <div className="panel kb-panel">
        <div className="ph">
          <span className="ph-title">键位热力</span>
          <div className="seg" id="dispSeg" role="group" aria-label="显示模式">
            {([['all', '全部'], ['heat', '仅热力'], ['real', '仅实时']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                data-v={v}
                aria-pressed={state.disp === v}
                onClick={() => dispatch({ type: 'setDisp', disp: v })}
              >{label}</button>
            ))}
          </div>
          <div className="seg" id="layoutSeg" role="group" aria-label="键盘布局">
            {[104, 87].map(v => (
              <button
                key={v}
                type="button"
                data-v={v}
                aria-pressed={state.layout === v}
                onClick={() => dispatch({ type: 'setLayout', layout: v as 104 | 87 })}
              >{v}</button>
            ))}
          </div>
          <div className="ph-spacer" />
          <span className="ph-meta" id="kbRangeMeta">{rangeLabel}{state.viewReset ? ' · 视图已重置' : ''}</span>
          <button
            className="tbtn"
            id="resetView"
            type="button"
            onClick={() => {
              if (state.viewReset) {
                dispatch({ type: 'restore' });
                dispatch({ type: 'toast', message: '已恢复视图显示。' });
              } else {
                dispatch({ type: 'modal', modal: 'reset' });
              }
            }}
          >重置视图</button>
          <button
            className="tbtn"
            id="exportKb"
            type="button"
            disabled
            title="M4 再实现真实导出"
          >导出 CSV <span className="m4badge">M4</span></button>
        </div>

        <KeyboardCanvas
          ref={kbRef}
          active={active}
          layout={state.layout}
          disp={state.disp}
          counts={counts}
          maxCount={maxCount}
          sel={state.sel}
          paused={state.paused}
          empty={state.empty}
          reduce={reduceMotion}
        />

        <div className="page-mask" id="kbMask" hidden={!maskShown}>
          <div className="mask-title" id="kbMaskTitle">{state.paused ? '记录已暂停' : '还没有记录到按键 —— 敲几个键试试'}</div>
          <div className="mask-note" id="kbMaskNote">{state.paused ? pauseText : isTauri ? '数据已清空，点「开始记录」后继续统计。' : '示例数据已清空。'}</div>
          <button
            className="mask-btn"
            id="kbMaskBtn"
            type="button"
            onClick={() => {
              if (state.paused) dispatch({ type: 'togglePause' });
              else dispatch({ type: 'restore' });
            }}
          >{state.paused ? '恢复采集' : isTauri ? '开始记录' : '恢复演示数据'}</button>
        </div>
      </div>

      <div className="panel top10">
        <div className="ph">
          <div className="seg" id="kbBottomSeg" role="group" aria-label="键盘底部视图">
            <button
              type="button"
              aria-pressed={bottomTab === 'top10'}
              onClick={() => setBottomTab('top10')}
            >Top 10</button>
            <button
              type="button"
              aria-pressed={bottomTab === 'patterns'}
              onClick={() => setBottomTab('patterns')}
            >操作习惯</button>
          </div>
          <div className="ph-spacer" />
          <span className="ph-meta">
            {bottomTab === 'top10' ? '占比 = 次数 / 全部按键' : '无序组合 · 不含精确时序'}
          </span>
        </div>
        {bottomTab === 'top10' ? (
          <Top10List
            keyStats={keyStats}
            total={total}
            sel={state.sel}
            empty={state.empty}
            viewReset={state.viewReset}
            onPick={(label) => pick(label, true)}
          />
        ) : (
          <KeyboardPatterns patterns={patterns} overlay={patternsOverlay} keyStats={keyStats} />
        )}
      </div>

      <div className="kbfoot" id="kbFoot">
        <LegendChips
          keyStats={keyStats}
          sel={state.sel}
          empty={state.empty}
          viewReset={state.viewReset}
          onPick={(label) => pick(label)}
        />
        <div className="foot-note">按住 A 键 3.4 秒，仍计 1 次。</div>
      </div>
    </section>
  );
}
