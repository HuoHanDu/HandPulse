// 手柄示意图：HandPulse 自绘 SVG，按 Gamepad API 标准索引叠加按键高亮。
import xboxSvg from './controller/xbox.svg?raw';
import psSvg from './controller/ps.svg?raw';
import switchSvg from './controller/switch.svg?raw';
import {
  PS_POINTS,
  PS_STICKS,
  SWITCH_POINTS,
  SWITCH_STICKS,
  XBOX_POINTS,
  XBOX_STICKS
} from './controllerPoints';

export type ControllerLayout = 'xbox' | 'playstation' | 'switch';

interface Props {
  type: ControllerLayout;
  buttons: boolean[];
  axes: number[];
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
  points: XBOX_POINTS as Record<number, Point>,
  sticks: XBOX_STICKS as [Stick, Stick]
};

const PS: Art = {
  svg: psSvg,
  viewBox: '0 0 128 128',
  points: PS_POINTS as Record<number, Point>,
  sticks: PS_STICKS as [Stick, Stick]
};

const SWITCH: Art = {
  svg: switchSvg,
  viewBox: '0 0 400 250',
  points: SWITCH_POINTS as Record<number, Point>,
  sticks: SWITCH_STICKS as [Stick, Stick]
};

const ART: Record<ControllerLayout, Art> = {
  xbox: XBOX,
  playstation: PS,
  switch: SWITCH
};

export function ControllerGraphic({ type, buttons, axes, connected = false }: Props) {
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
              <circle cx={p.x} cy={p.y} r={p.r + (type === 'playstation' ? 3 : 5)} className="pad-hit-halo" />
              <circle cx={p.x} cy={p.y} r={p.r} className="pad-hit-ring" />
            </g>
          );
        })}

        {/* 摇杆中心点跟随轴偏移；原图里的杆帽位置不动，用高亮点表示方向 */}
        {connected && <circle cx={left.x + lx} cy={left.y - ly} r="4.5" className="pad-stick-dot" />}
        {connected && <circle cx={right.x + rx} cy={right.y - ry} r="4.5" className="pad-stick-dot" />}
        {press(10) && <circle cx={left.x} cy={left.y} r={left.scale + 5} className="pad-hit-ring" />}
        {press(11) && <circle cx={right.x} cy={right.y} r={right.scale + 5} className="pad-hit-ring" />}
      </svg>
    </div>
  );
}
