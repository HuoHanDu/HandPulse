import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../ipc/client';

const win = isTauri ? getCurrentWindow() : null;

type ResizeDir = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

const HANDLES: Array<[string, ResizeDir]> = [
  ['n', 'North'],
  ['s', 'South'],
  ['e', 'East'],
  ['w', 'West'],
  ['ne', 'NorthEast'],
  ['nw', 'NorthWest'],
  ['se', 'SouthEast'],
  ['sw', 'SouthWest']
];

/**
 * 无边框窗口没有 Windows 原生缩放边框，用 8 个透明热区调 Tauri 的
 * startResizeDragging()。位置固定、命中区只有 4–6px，不挡内容。
 */
export function ResizeHandles() {
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

  if (!win || max) return null;

  return (
    <div className="resize-layer" aria-hidden="true">
      {HANDLES.map(([dir, direction]) => (
        <div
          key={dir}
          className={'resize-handle rh-' + dir}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            void invoke('start_resize', { direction }).catch(() => {});
          }}
        />
      ))}
    </div>
  );
}
