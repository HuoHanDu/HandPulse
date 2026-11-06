import { useSyncExternalStore } from 'react';
import type { Route } from './store';

const ROUTES: Route[] = ['keyboard', 'mouse', 'gamepad', 'stats', 'data', 'settings'];

export function parseRoute(): Route {
  const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as string[]).includes(h) ? (h as Route) : 'keyboard';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** hash 路由（#/keyboard 等），与原型一致；不引 router 库。 */
export function useHashRoute(): Route {
  return useSyncExternalStore(subscribe, parseRoute, () => 'keyboard' as Route);
}

export function ensureDefaultHash(): void {
  if (location.hash) return;
  try {
    history.replaceState(null, '', '#/keyboard');
  } catch {
    location.hash = '#/keyboard';
  }
}
