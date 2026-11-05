import { useEffect, useReducer, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppContext, initialState, reducer } from './app/store';
import { ensureDefaultHash, useHashRoute } from './app/router';
import { startLive } from './ipc/live';
import { getDataVersion, isTauri } from './ipc/client';
import { clearPageDataCache } from './state/usePageData';
import { Rail } from './shell/Rail';
import { Transport } from './shell/Transport';
import { LiveTape } from './shell/LiveTape';
import { Inspector } from './shell/Inspector';
import { KeyboardPage } from './pages/KeyboardPage';
import { MousePage } from './pages/MousePage';
import { StatsPage } from './pages/StatsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Modal } from './ui/Modal';
import { Toast } from './ui/Toast';

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const route = useHashRoute();
  const pausedRef = useRef(state.paused);
  pausedRef.current = state.paused;

  useEffect(() => {
    ensureDefaultHash();
  }, []);

  useEffect(() => {
    dispatch({ type: 'setRoute', route });
    document.body.dataset.route = route;
    document.title = '手脉 HandPulse';
  }, [route]);

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    startLive({
      isPaused: () => pausedRef.current,
      onError: (message) => dispatch({ type: 'toast', message })
    })
      .then((fn) => {
        if (alive) stop = fn;
        else fn();
      })
      .catch((err) => {
        dispatch({ type: 'toast', message: '实时采集连接失败：' + String(err) });
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  // clear / restore 后历史数据缓存失效，下一次访问重新加载
  useEffect(() => {
    clearPageDataCache();
  }, [state.empty]);

  // 历史数据版本：writer 落桶/清空/设置变更后递增；每 1s 轮询并刷新页面缓存。
  // 同时每轮递增本地 cache generation，让“今日”查询能把未关闭的当前桶也算进去。
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    let gen = 0;
    const poll = () => {
      getDataVersion()
        .then((version) => {
          if (!alive) return;
          gen = Math.max(gen, version) + 1;
          dispatch({ type: 'setDataVersion', value: gen });
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (state.dataVersion > 1) clearPageDataCache();
  }, [state.dataVersion]);

  // 暂停状态同步给 Rust 采集层（浏览器 mock 忽略）
  useEffect(() => {
    if (!isTauri) return;
    invoke('set_paused', { paused: state.paused }).catch(() => {});
  }, [state.paused]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: 'hideToast' }), 2600);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (state.modal) {
        dispatch({ type: 'modal', modal: null });
        return;
      }
      if (state.route === 'keyboard' && state.sel) {
        dispatch({ type: 'select', label: null });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.modal, state.route, state.sel]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div className="app" id="app">
        <Rail />
        <main className="main">
          <Transport />
          <LiveTape />
          <div className="view" id="view">
            <KeyboardPage active={state.route === 'keyboard'} />
            <MousePage active={state.route === 'mouse'} />
            <StatsPage active={state.route === 'stats'} />
            <SettingsPage active={state.route === 'settings'} />
          </div>
        </main>
        <Inspector />
      </div>
      <Modal />
      <Toast />
    </AppContext.Provider>
  );
}
