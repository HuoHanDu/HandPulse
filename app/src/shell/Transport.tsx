import { RANGE_OPTS, TITLES, useApp } from '../app/store';
import { getSummary } from '../ipc/client';
import { usePageData } from '../state/usePageData';
import { Segmented } from '../ui/Segmented';

export function Transport() {
  const { state, dispatch } = useApp();
  const summary = usePageData('summary:today', () => getSummary('today'));
  const number = (v: number | undefined) => (state.empty ? '0' : (v ?? 0).toLocaleString('en-US'));

  return (
    <header className="transport">
      <h1 className="tp-title" id="tpTitle">{TITLES[state.route]}</h1>
      <button
        className="status"
        id="statusBtn"
        type="button"
        aria-pressed={state.paused}
        title={state.paused ? '恢复记录' : '暂停记录'}
        onClick={() => dispatch({ type: 'togglePause' })}
      >
        <span className={'live-dot' + (state.paused ? ' is-paused' : '')} id="statusDot" />
        <span id="statusText">{state.paused ? '已暂停' : '运行中'}</span>
      </button>
      <span className="tp-date mono">2026-11-04 周三</span>
      {state.route === 'settings' ? (
        <div className="seg" id="rangeSeg" role="group" aria-label="时间范围">
          <span className="tp-static">全部时间</span>
        </div>
      ) : (
        <Segmented
          id="rangeSeg"
          label="时间范围"
          options={RANGE_OPTS[state.route].map(([value, label]) => ({ value, label }))}
          value={state.ranges[state.route]}
          onChange={(range) => dispatch({ type: 'setRange', route: state.route, range })}
        />
      )}
      <div className="tp-spacer" />
      <div className="tp-readout"><span>今日动作</span><b className="mono" id="roActions">{number(summary?.actions)}</b></div>
      <div className="tp-readout"><span>按键</span><b className="mono" id="roKeys">{number(summary?.keys)}</b></div>
      <div className="tp-readout"><span>点击</span><b className="mono" id="roClicks">{number(summary?.clicks)}</b></div>
      <span className="tp-time mono">21:43</span>
      <button
        className="icon-btn"
        id="pauseBtn"
        type="button"
        aria-label={state.paused ? '恢复记录' : '暂停记录'}
        aria-pressed={state.paused}
        title={state.paused ? '恢复记录' : '暂停记录'}
        onClick={() => dispatch({ type: 'togglePause' })}
      >
        {state.paused ? (
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.6" height="12" rx="1" /><rect x="9.4" y="2" width="3.6" height="12" rx="1" /></svg>
        )}
      </button>
    </header>
  );
}
