import type { ReactNode } from 'react';
import { useApp, type Route } from '../app/store';

const ITEMS: Array<{ route: Route; label: string; path: ReactNode }> = [
  {
    route: 'keyboard',
    label: '键盘查看',
    path: (
      <>
        <rect x="2.5" y="6.5" width="19" height="11" rx="1.8" />
        <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 13.5h.01M18 13.5h.01M9 13.5h9" />
      </>
    )
  },
  {
    route: 'mouse',
    label: '鼠标查看',
    path: (
      <>
        <rect x="7.5" y="2.5" width="9" height="19" rx="4.5" />
        <path d="M12 3v8M7.5 11h9" />
      </>
    )
  },
  {
    route: 'stats',
    label: '数据展示',
    path: <path d="M4 19V11M9.3 19V5M14.7 19v-6M20 19V9" />
  },
  {
    route: 'settings',
    label: '设置',
    path: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    )
  }
];

export function Rail() {
  const { state } = useApp();
  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail-brand" aria-hidden="true">手脉</div>
      <div className="rail-list">
        {ITEMS.map(item => (
          <a
            key={item.route}
            className="rail-btn"
            href={'#/' + item.route}
            data-r={item.route}
            aria-label={item.label}
            title={item.label}
            aria-current={state.route === item.route ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {item.path}
            </svg>
          </a>
        ))}
      </div>
      <div className="rail-foot">
        <span
          className={'live-dot' + (state.paused ? ' is-paused' : '')}
          id="railDot"
          title={state.paused ? '采集已暂停' : '采集运行中'}
        />
      </div>
    </nav>
  );
}
