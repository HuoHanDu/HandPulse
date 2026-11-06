// 控制器底图取自 GamepadTester.cn（用户指定参考），在本项目中仅用于本地手柄适配展示。
import xboxSvg from './controller/xbox.svg?raw';
import psSvg from './controller/ps.svg?raw';
import switchSvg from './controller/switch.svg?raw';

export type ControllerLayout = 'xbox' | 'playstation' | 'switch';

interface Props {
  type: ControllerLayout;
  buttons: boolean[];
  axes: number[];
  triggers: number[];
  connected?: boolean;
}

interface Point {
  x: number;
  y: number;
  r: number;
}

interface Stick {
  x: number;
  y: number;
  scale: number;
}

interface Art {
  svg: string;
  viewBox: string;
  points: Record<number, Point>;
  sticks: [Stick, Stick];
}

const XBOX: Art = {
  svg: xboxSvg,
  viewBox: '0 0 441 383',
  points: {
    0: { x: 330, y: 181, r: 14 },
    1: { x: 348, y: 161, r: 14 },
    2: { x: 310, y: 162, r: 14 },
    3: { x: 329, y: 140, r: 14 },
    4: { x: 138.5, y: 75, r: 19 },
    5: { x: 302.5, y: 75, r: 19 },
    6: { x: 138.5, y: 75, r: 19 },
    7: { x: 302.5, y: 75, r: 19 },
    8: { x: 188, y: 162, r: 13 },
    9: { x: 253, y: 162, r: 13 },
    10: { x: 113, y: 160, r: 30 },
    11: { x: 278, y: 238, r: 30 },
    12: { x: 166, y: 220, r: 11 },
    13: { x: 166, y: 256, r: 11 },
    14: { x: 150, y: 238, r: 11 },
    15: { x: 182, y: 238, r: 11 },
    16: { x: 220.5, y: 125, r: 17 }
  },
  sticks: [
    { x: 113, y: 160, scale: 17 },
    { x: 278, y: 238, scale: 17 }
  ]
};

const PS: Art = {
  svg: psSvg,
  viewBox: '0 0 128 128',
  points: {
    0: { x: 99, y: 56, r: 7 },
    1: { x: 107, y: 48, r: 7 },
    2: { x: 91, y: 48, r: 7 },
    3: { x: 99, y: 40, r: 7 },
    4: { x: 32, y: 30, r: 7 },
    5: { x: 96, y: 30, r: 7 },
    8: { x: 31, y: 33, r: 5 },
    9: { x: 96, y: 33, r: 5 },
    10: { x: 45.5, y: 64.5, r: 10 },
    11: { x: 82.5, y: 64.5, r: 10 },
    12: { x: 29, y: 42, r: 4 },
    13: { x: 29, y: 56, r: 4 },
    14: { x: 23, y: 49, r: 4 },
    15: { x: 35, y: 49, r: 4 },
    16: { x: 65, y: 61, r: 5 }
  },
  sticks: [
    { x: 45.5, y: 64.5, scale: 7 },
    { x: 82.5, y: 64.5, scale: 7 }
  ]
};

const SWITCH: Art = {
  svg: switchSvg,
  viewBox: '0 0 400 250',
  points: {
    0: { x: 275, y: 102, r: 9 },
    1: { x: 258, y: 85, r: 9 },
    2: { x: 292, y: 85, r: 9 },
    3: { x: 275, y: 68, r: 9 },
    4: { x: 75, y: 25, r: 8 },
    5: { x: 325, y: 25, r: 8 },
    8: { x: 65, y: 190, r: 5 },
    9: { x: 315, y: 190, r: 5 },
    10: { x: 95, y: 85, r: 17 },
    11: { x: 275, y: 155, r: 17 },
    12: { x: 95, y: 137, r: 7 },
    13: { x: 95, y: 173, r: 7 },
    14: { x: 77, y: 155, r: 7 },
    15: { x: 113, y: 155, r: 7 },
    16: { x: 200, y: 27, r: 5 }
  },
  sticks: [
    { x: 95, y: 85, scale: 9 },
    { x: 275, y: 155, scale: 9 }
  ]
};

const ART: Record<ControllerLayout, Art> = {
  xbox: XBOX,
  playstation: PS,
  switch: SWITCH
};

export function ControllerGraphic({ type, buttons, axes, triggers, connected = false }: Props) {
  const art = ART[type];
  const [left, right] = art.sticks;
  const press = (i: number) => buttons[i] === true;
  const lx = (axes[0] ?? 0) * left.scale;
  const ly = (axes[1] ?? 0) * left.scale;
  const rx = (axes[2] ?? 0) * right.scale;
  const ry = (axes[3] ?? 0) * right.scale;

  return (
    <div className="pad-art">
      <div className="pad-art-base" dangerouslySetInnerHTML={{ __html: art.svg }} />
      <svg className="pad-overlay" viewBox={art.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {/* 按键点亮：把原图当作底图，叠一层发光环，避免破坏原图比例 */}
        {Object.entries(art.points).map(([index, p]) => {
          const i = Number(index);
          if (!press(i)) return null;
          return (
            <g key={index} className="pad-hit">
              <circle cx={p.x} cy={p.y} r={p.r + 5} className="pad-hit-halo" />
              <circle cx={p.x} cy={p.y} r={p.r} className="pad-hit-ring" />
            </g>
          );
        })}

        {/* 摇杆中心点跟随轴偏移；原图里的杆帽位置不动，用高亮点表示方向 */}
        {connected && <circle cx={left.x + lx} cy={left.y - ly} r="4.5" className="pad-stick-dot" />}
        {connected && <circle cx={right.x + rx} cy={right.y - ry} r="4.5" className="pad-stick-dot" />}
        {press(10) && <circle cx={left.x} cy={left.y} r={left.scale + 5} className="pad-hit-ring" />}
        {press(11) && <circle cx={right.x} cy={right.y} r={right.scale + 5} className="pad-hit-ring" />}

        {/* 扳机不进原图时，用两侧肩键位置做一个细条提示 */}
        {triggers[0] > 0.02 && (
          <rect
            x={type === 'xbox' ? 116 : type === 'playstation' ? 22 : 60}
            y={type === 'xbox' ? 57 : type === 'playstation' ? 22 : 25}
            width={type === 'xbox' ? 46 : type === 'playstation' ? 20 : 30}
            height="3"
            rx="1.5"
            className="pad-trigger-mark"
            opacity={0.35 + Math.min(0.65, triggers[0])}
          />
        )}
        {triggers[1] > 0.02 && (
          <rect
            x={type === 'xbox' ? 280 : type === 'playstation' ? 88 : 310}
            y={type === 'xbox' ? 57 : type === 'playstation' ? 22 : 25}
            width={type === 'xbox' ? 46 : type === 'playstation' ? 20 : 30}
            height="3"
            rx="1.5"
            className="pad-trigger-mark"
            opacity={0.35 + Math.min(0.65, triggers[1])}
          />
        )}
      </svg>
    </div>
  );
}
