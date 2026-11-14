import { useSyncExternalStore } from 'react';

const KEY = 'hp.foreground.enabled';
const EVENT = 'hp:foreground-change';

export function readForegroundEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function writeForegroundEnabled(enabled: boolean): void {
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch {}
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: enabled }));
}

function subscribe(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function useForegroundEnabled(): boolean {
  return useSyncExternalStore(subscribe, readForegroundEnabled, () => false);
}
