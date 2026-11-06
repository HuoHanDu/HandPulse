import { useEffect, useRef, useState } from 'react';

interface Props {
  active: boolean;
}

const BUTTONS: Array<[number, string]> = [
  [0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'],
  [4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'],
  [8, 'Back'], [9, 'Start'], [10, 'LS'], [11, 'RS'],
  [12, '↑'], [13, '↓'], [14, '←'], [15, '→'], [16, 'Home']
];

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function GamepadPage({ active }: Props) {
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState('');
  const [mapping, setMapping] = useState('');
  const [pressed, setPressed] = useState<boolean[]>([]);
  const [counts, setCounts] = useState<number[]>([]);
  const [axes, setAxes] = useState<number[]>([]);
  const [last, setLast] = useState('等待输入…');
  const previous = useRef<boolean[]>([]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer = 0;
    const tick = () => {
      if (!alive) return;
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const pad = pads ? Array.from(pads).find((p): p is Gamepad => !!p && p.connected) : undefined;
      if (!pad) {
        setConnected(false);
        setName('');
        setMapping('');
        setPressed([]);
        setAxes([]);
        timer = window.setTimeout(tick, 250);
        return;
      }
      setConnected(true);
      setName(pad.id);
      setMapping(pad.mapping || '非标准');
      setPressed(pad.buttons.map((b) => b.pressed));
      setAxes(pad.axes.map((v) => Math.abs(v) < 0.04 ? 0 : v));
      setCounts((prev) => {
        const next = prev.length === pad.buttons.length ? prev.slice() : new Array(pad.buttons.length).fill(0);
        pad.buttons.forEach((b, i) => {
          if (b.pressed && !previous.current[i]) next[i] = (next[i] ?? 0) + 1;
        });
        return next;
      });
      previous.current = pad.buttons.map((b) => b.pressed);
      const down = pad.buttons.findIndex((b) => b.pressed);
      if (down >= 0) {
        const label = BUTTONS.find(([i]) => i === down)?.[1] ?? 'B' + down;
        setLast('按下 ' + label + ' · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      }
      timer = window.setTimeout(tick, 60);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active]);

  const axisLabel = (i: number) => ['左摇杆 X', '左摇杆 Y', '右摇杆 X', '右摇杆 Y'][i] ?? '轴 ' + i;

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="gamepad" aria-label="手柄适配">
      <header className="g-head">
        <h1>手柄适配</h1>
        <p>连接手柄后按任意键或推动摇杆，检查按键、摇杆和扳机是否被正确识别。</p>
      </header>

      <div className="panel pad-status">
        <div className={'pad-dot' + (connected ? ' on' : '')} />
        <div>
          <div className="pad-status-title">{connected ? '已连接' : '未检测到手柄'}</div>
          <div className="pad-status-sub">{connected ? name : '插上 USB / 蓝牙手柄，然后按一下任意键'}</div>
        </div>
        <div className="pad-status-meta">
          <span>{connected ? 'Mapping: ' + mapping : '前台适配页'}</span>
          <span>{last}</span>
        </div>
        <button className="tbtn" type="button" disabled={!connected} onClick={() => setCounts([])}>清零计数</button>
      </div>

      <div className="pad-grid">
        <div className="panel pad-panel">
          <div className="ph"><span className="ph-title">按键</span><span className="ph-meta">按下计数 / 实时状态</span></div>
          <div className="pad-buttons">
            {BUTTONS.map(([i, label]) => (
              <div key={i} className={'pad-btn' + (pressed[i] ? ' is-down' : '')}>
                <span className="pad-btn-label">{label}</span>
                <span className="pad-btn-idx mono">{i}</span>
                <span className="pad-btn-count mono">{pad2(counts[i] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel pad-panel">
          <div className="ph"><span className="ph-title">摇杆 / 扳机</span><span className="ph-meta">归一化到 -1…1</span></div>
          <div className="pad-axes">
            {axes.length === 0 ? (
              <div className="pad-empty">连接手柄后显示轴数据。</div>
            ) : axes.map((v, i) => (
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
          <div className="pad-hint">
            标准映射：A/B/X/Y、肩键、扳机、十字键、双摇杆。不同手柄的轴顺序可能不同，可在这里确认实际编号。
          </div>
        </div>
      </div>

      <div className="panel pad-note">
        <span className="pad-note-title">说明</span>
        <span>当前页面通过浏览器 Gamepad API 做前台适配，不上传、不写入数据库；后台手柄持久采集需要单独的 HID/轴映射方案，暂未包含。</span>
      </div>
    </section>
  );
}
