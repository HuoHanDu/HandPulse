import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ControllerGraphic, type ControllerLayout } from '../components/ControllerGraphic';

interface Props {
  active: boolean;
}

interface BackendPad {
  connected: boolean;
  index: number;
  buttons: boolean[];
  axes: number[];
  triggers: number[];
}

const BUTTONS: Array<[number, string]> = [
  [0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'],
  [4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'],
  [8, 'Back'], [9, 'Start'], [10, 'LS'], [11, 'RS'],
  [12, '↑'], [13, '↓'], [14, '←'], [15, '→'], [16, 'Home']
];

function emptyPad(): BackendPad {
  return { connected: false, index: 0, buttons: new Array(17).fill(false), axes: [0, 0, 0, 0], triggers: [0, 0] };
}

function fromBrowser(pad: Gamepad): BackendPad {
  const buttons = new Array(17).fill(false);
  pad.buttons.forEach((b, i) => { if (i < 17) buttons[i] = b.pressed; });
  const axes = [pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), pad.axes[2] ?? 0, -(pad.axes[3] ?? 0)];
  const triggers = [pad.buttons[6]?.value ?? 0, pad.buttons[7]?.value ?? 0];
  return { connected: true, index: 0, buttons, axes, triggers };
}

export function GamepadPage({ active }: Props) {
  const [pad, setPad] = useState<BackendPad>(emptyPad);
  const [source, setSource] = useState<'xinput' | 'browser' | ''>('');
  const [layout, setLayout] = useState<'auto' | ControllerLayout>('auto');
  const [detected, setDetected] = useState<ControllerLayout>('xbox');
  const [counts, setCounts] = useState<number[]>(new Array(17).fill(0));
  const [last, setLast] = useState('等待输入…');
  const previous = useRef<boolean[]>(new Array(17).fill(false));

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer = 0;

    const tick = async () => {
      if (!alive) return;
      let next = emptyPad();
      let src: 'xinput' | 'browser' | '' = '';
      try {
        const raw = await invoke<BackendPad>('get_gamepad_state');
        if (raw?.connected) {
          next = raw;
          src = 'xinput';
          setDetected('xbox');
        }
      } catch {
        // 非 Windows 构建或命令不存在时，退回浏览器 Gamepad API。
      }
      if (!next.connected && typeof navigator.getGamepads === 'function') {
        const pads = navigator.getGamepads();
        const browserPad = pads ? Array.from(pads).find((p): p is Gamepad => !!p && p.connected) : undefined;
        if (browserPad) {
          next = fromBrowser(browserPad);
          src = 'browser';
          const id = browserPad.id || '';
          setDetected(
            /dualsense|dualshock|playstation|\bps[45]\b/i.test(id)
              ? 'playstation'
              : /joy-?con|switch|pro controller/i.test(id)
                ? 'switch'
                : 'xbox'
          );
        }
      }
      setPad(next);
      setSource(src);
      if (next.connected) {
        setCounts((prev) => {
          const copy = prev.length === next.buttons.length ? prev.slice() : new Array(next.buttons.length).fill(0);
          next.buttons.forEach((down, i) => {
            if (down && !previous.current[i]) copy[i] = (copy[i] ?? 0) + 1;
          });
          return copy;
        });
        previous.current = next.buttons.slice();
        const down = next.buttons.findIndex(Boolean);
        if (down >= 0) {
          const label = BUTTONS.find(([i]) => i === down)?.[1] ?? 'B' + down;
          setLast('按下 ' + label + ' · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        }
      } else {
        previous.current = new Array(17).fill(false);
      }
      timer = window.setTimeout(tick, 50);
    };

    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active]);

  const axisLabel = (i: number) => ['左摇杆 X', '左摇杆 Y', '右摇杆 X', '右摇杆 Y'][i] ?? '轴 ' + i;
  const view = layout === 'auto' ? detected : layout;

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="gamepad" aria-label="手柄适配">
      <header className="g-head">
        <h1>手柄适配</h1>
        <p>接上手柄后按任意键或推动摇杆；XInput 手柄由本机直接读取，不依赖窗口焦点。</p>
      </header>

      <div className="panel pad-status">
        <div className={'pad-dot' + (pad.connected ? ' on' : '')} />
        <div>
          <div className="pad-status-title">{pad.connected ? '已连接' : '未检测到手柄'}</div>
          <div className="pad-status-sub">
            {pad.connected
              ? (source === 'xinput' ? `XInput 手柄 #${pad.index}` : '浏览器 Gamepad API')
              : '插上 USB / 蓝牙手柄，然后按一下任意键；Xbox 手柄优先走 XInput'}
          </div>
        </div>
        <div className="pad-status-meta">
          <span>{pad.connected ? (source === 'xinput' ? 'XInput' : 'Gamepad API') : '前台适配页'}</span>
          <span>{last}</span>
        </div>
        <button className="tbtn" type="button" disabled={!pad.connected} onClick={() => setCounts(new Array(17).fill(0))}>清零计数</button>
      </div>

      <div className="pad-stage">
        <div className="panel pad-visual">
          <div className="ph">
            <span className="ph-title">手柄示意</span>
            <span className="ph-meta">按键 / 摇杆 / 扳机实时状态</span>
            <div className="ph-spacer" />
            <div className="pad-layout-tabs" role="group" aria-label="手柄布局">
              {([
                ['auto', '自动'],
                ['xbox', 'Xbox'],
                ['playstation', 'PS'],
                ['switch', 'Switch']
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={layout === value ? 'is-active' : ''}
                  aria-pressed={layout === value}
                  onClick={() => setLayout(value)}
                >{label}</button>
              ))}
            </div>
          </div>
          <ControllerGraphic type={view} buttons={pad.buttons} axes={pad.axes} triggers={pad.triggers} connected={pad.connected} />
        </div>

        <div className="panel pad-side">
          <div className="ph"><span className="ph-title">按键</span><span className="ph-meta">按下计数</span></div>
          <div className="pad-buttons">
            {BUTTONS.map(([i, label]) => (
              <div key={i} className={'pad-btn' + (pad.buttons[i] ? ' is-down' : '')}>
                <span className="pad-btn-label">{label}</span>
                <span className="pad-btn-idx mono">{i}</span>
                <span className="pad-btn-count mono">{String(counts[i] ?? 0).padStart(2, '0')}</span>
              </div>
            ))}
          </div>
          <div className="pad-axes">
            {pad.axes.map((v, i) => (
              <div className="pad-axis" key={i}>
                <div className="pad-axis-top"><span>{axisLabel(i)}</span><span className="mono">{v >= 0 ? '+' : ''}{v.toFixed(2)}</span></div>
                <div className="pad-axis-track">
                  <span className="pad-axis-zero" />
                  <span
                    className="pad-axis-fill"
                    style={v >= 0
                      ? { left: '50%', width: (Math.min(1, v) * 50).toFixed(1) + '%' }
                      : { right: '50%', width: (Math.min(1, -v) * 50).toFixed(1) + '%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel pad-note">
        <span className="pad-note-title">说明</span>
        <span>当前页面用 XInput / Gamepad API 做前台适配；XInput 的按键按下会同时写入分钟桶，可在“数据浏览 → 手柄”查看历史。摇杆/扳机目前只做实时显示。</span>
      </div>
    </section>
  );
}
