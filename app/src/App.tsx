import { useEffect, useReducer } from 'react';
import { AppContext, initialState, reducer } from './app/store';
import { ensureDefaultHash, useHashRoute } from './app/router';
import { startLive } from './ipc/live';
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

  useEffect(() => {
    ensureDefaultHash();
  }, []);

  useEffect(() => {
    dispatch({ type: 'setRoute', route });
    document.body.dataset.route = route;
    document.title = '手脉 HandPulse';
  }, [route]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    startLive().then((fn) => { stop = fn; });
    return () => { stop?.(); };
  }, []);

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
