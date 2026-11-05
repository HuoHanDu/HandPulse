import { useEffect, useState, type MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../ipc/client';

const win = isTauri ? getCurrentWindow() : null;

export function TitleBar() {
  const [max, setMax] = useState(false);

  useEffect(() => {
    if (!win) return;
    let alive = true;
    const sync = () => {
      win.isMaximized().then(v => { if (alive) setMax(v); }).catch(() => {});
    };
    sync();
    const un = win.onResized(sync);
    return () => {
      alive = false;
      un.then(fn => fn());
    };
  }, []);

  const onDrag = (e: MouseEvent<HTMLDivElement>) => {
    if (!win || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    if (e.detail === 2) void win.toggleMaximize();
    else void win.startDragging();
  };

  return (
    <div className="titlebar" id="titlebar" onMouseDown={onDrag}>
      <div className="tb-brand">
        <span className="tb-mark" aria-hidden="true"><i /><i /><i /></span>
        <span className="tb-name">手脉 HandPulse</span>
      </div>
      <div className="tb-spacer" />
      <div className="tb-controls" aria-label="窗口控制">
        <button
          className="tb-btn"
          type="button"
          aria-label="最小化"
          title="最小化"
          disabled={!win}
          onClick={() => void win?.minimize()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 5h6" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button
          className="tb-btn"
          type="button"
          aria-label={max ? '还原' : '最大化'}
          title={max ? '还原' : '最大化'}
          disabled={!win}
          onClick={() => void win?.toggleMaximize()}
        >
          {max
            ? <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3 3h4v4H3zM4 3V2h4v4H7" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
            : <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><rect x="2.2" y="2.2" width="5.6" height="5.6" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>}
        </button>
        <button
          className="tb-btn tb-close"
          type="button"
          aria-label="关闭"
          title="关闭"
          disabled={!win}
          onClick={() => void win?.close()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2.2 2.2l5.6 5.6M7.8 2.2L2.2 7.8" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </div>
  );
}
