import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../ipc/client';

const win = isTauri ? getCurrentWindow() : null;
const KEY = 'hp.closeBehavior';

export type CloseBehavior = 'ask' | 'tray' | 'quit';
export const CLOSE_BEHAVIOR_EVENT = 'hp-close-behavior';

export function readCloseBehavior(): CloseBehavior {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'tray' || value === 'quit') return value;
  } catch {
    // localStorage 不可用时退回每次询问
  }
  return 'ask';
}

export function writeCloseBehavior(value: CloseBehavior): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(CLOSE_BEHAVIOR_EVENT));
}

/**
 * 关闭窗口的拦截器：
 * - ask：首次关闭弹窗选择“直接关闭/最小化到托盘”，可勾选记住；
 * - tray：隐藏窗口，采集继续在后台运行；
 * - quit：退出进程（Rust 会先关闭当前桶并 drain writer）。
 */
export function CloseGuard() {
  const [asking, setAsking] = useState(false);
  const [remember, setRemember] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!win) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    win.onCloseRequested((event) => {
      event.preventDefault();
      if (busy.current) return;
      const behavior = readCloseBehavior();
      if (behavior === 'tray') {
        void invoke('set_main_hidden', { hidden: true });
        return;
      }
      if (behavior === 'quit') {
        busy.current = true;
        void invoke('quit_app').catch(() => { busy.current = false; });
        return;
      }
      setRemember(false);
      setAsking(true);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    }).catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  if (!win || !asking) return null;

  const choose = (behavior: 'tray' | 'quit') => {
    setAsking(false);
    if (remember) writeCloseBehavior(behavior);
    if (behavior === 'tray') {
      void invoke('set_main_hidden', { hidden: true });
    } else {
      busy.current = true;
      void invoke('quit_app').catch(() => { busy.current = false; });
    }
  };

  return (
    <div className="modal close-modal" role="presentation">
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="closeTitle">
        <div className="modal-head">
          <span id="closeTitle">关闭手脉？</span>
          <button className="modal-x" type="button" aria-label="取消" onClick={() => setAsking(false)}>×</button>
        </div>
        <div className="modal-body">
          <p className="modal-p">
            直接关闭会退出应用并停止采集；最小化到托盘后，手脉会继续在后台记录，可从系统托盘重新打开或退出。
          </p>
          <label className="close-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            记住此次选择
          </label>
          <div className="modal-actions close-actions">
            <button className="btn" type="button" onClick={() => setAsking(false)}>取消</button>
            <button className="btn" type="button" onClick={() => choose('quit')}>直接关闭</button>
            <button className="btn primary" type="button" onClick={() => choose('tray')}>最小化到托盘</button>
          </div>
        </div>
      </div>
    </div>
  );
}
