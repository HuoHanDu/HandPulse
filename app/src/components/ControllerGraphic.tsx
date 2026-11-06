export type ControllerLayout = 'xbox' | 'playstation' | 'switch';

interface Props {
  type: ControllerLayout;
  buttons: boolean[];
  axes: number[];
  triggers: number[];
}

const BODY = '#e4dfd6';
const BODY_2 = '#d4cec3';
const STROKE = '#a9a399';
const LIT = '#2997ff';

function Shadow() {
  return (
    <defs>
      <linearGradient id="controllerBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f2eee7" />
        <stop offset="0.55" stopColor={BODY} />
        <stop offset="1" stopColor="#cec8bc" />
      </linearGradient>
      <radialGradient id="stickWell" cx="0.5" cy="0.45" r="0.6">
        <stop offset="0" stopColor="#f1eee8" />
        <stop offset="1" stopColor="#cbc6bd" />
      </radialGradient>
      <filter id="controlShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#000" floodOpacity="0.28" />
      </filter>
    </defs>
  );
}

function XboxGraphic({ buttons, axes, triggers }: Omit<Props, 'type'>) {
  const lx = (axes[0] ?? 0) * 17;
  const ly = (axes[1] ?? 0) * 17;
  const rx = (axes[2] ?? 0) * 17;
  const ry = (axes[3] ?? 0) * 17;
  const on = (i: number) => buttons[i] === true;
  const face = (cx: number, cy: number, label: string, i: number) => (
    <g>
      <circle cx={cx} cy={cy} r="12.5" fill={on(i) ? LIT : BODY_2} stroke={STROKE} strokeWidth="1" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={on(i) ? '#fff' : '#77736c'}>{label}</text>
    </g>
  );

  return (
    <svg className="pad-svg" viewBox="0 0 441 383" role="img" aria-label="Xbox 手柄示意图">
      <Shadow />
      {/* shoulder / trigger */}
      <path d="M124 78c0-11 6-18 15-18h28c8 0 14 7 14 18v18c0 7-4 11-9 11h-39c-5 0-9-4-9-11Z" fill={on(4) ? LIT : BODY_2} stroke={STROKE} strokeWidth="2" />
      <text x="152" y="92" textAnchor="middle" fontSize="10" fill={on(4) ? '#fff' : '#8b877f'}>LB</text>
      <path d="M260 78c0-11 6-18 15-18h28c8 0 14 7 14 18v18c0 7-4 11-9 11h-39c-5 0-9-4-9-11Z" fill={on(5) ? LIT : BODY_2} stroke={STROKE} strokeWidth="2" />
      <text x="288" y="92" textAnchor="middle" fontSize="10" fill={on(5) ? '#fff' : '#8b877f'}>RB</text>
      <rect x="119" y="100" width="72" height="9" rx="4.5" fill="#d7d3ca" stroke={STROKE} />
      <rect x="121" y="102" width={(68 * Math.min(1, triggers[0] ?? 0)).toFixed(1)} height="5" rx="2.5" fill={LIT} opacity="0.75" />
      <rect x="250" y="100" width="72" height="9" rx="4.5" fill="#d7d3ca" stroke={STROKE} />
      <rect x="252" y="102" width={(68 * Math.min(1, triggers[1] ?? 0)).toFixed(1)} height="5" rx="2.5" fill={LIT} opacity="0.75" />

      {/* main body */}
      <g filter="url(#controlShadow)">
        <path
          d="M185 100h73c24 0 45 12 57 32l50 94c17 32 12 65-10 88-22 23-52 19-74-5l-28-30c-11-12-25-18-43-18h-40c-18 0-32 6-43 18l-28 30c-22 24-52 28-74 5-22-23-27-56-10-88l50-94c12-20 33-32 57-32Z"
          fill="url(#controllerBody)" stroke={STROKE} strokeWidth="2.4"
        />
        <path d="M128 142c15-20 38-30 68-30h65c30 0 53 10 68 30" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2" />
      </g>

      {/* home */}
      <circle cx="220" cy="160" r="18" fill={on(16) ? LIT : '#dedad2'} stroke={STROKE} />
      <path d="M211 163a13 13 0 0 1 18 0M215 168a7 7 0 0 1 10 0" fill="none" stroke={on(16) ? '#fff' : '#8d8981'} strokeWidth="2" strokeLinecap="round" />
      <text x="220" y="190" textAnchor="middle" fontSize="8" fill="#8b877f">XBOX</text>

      {/* sticks */}
      <g transform={`translate(${lx},${ly})`}>
        {on(10) && <circle cx="143" cy="190" r="35" fill="none" stroke={LIT} strokeWidth="2" opacity=".7" />}
        <circle cx="143" cy="190" r="30" fill="url(#stickWell)" stroke={STROKE} strokeWidth="2" />
        <circle cx="143" cy="190" r="22" fill="#d5d1c8" stroke="#bbb6ad" />
        <circle cx="143" cy="190" r="8" fill="#c5c0b7" />
      </g>
      <text x="143" y="231" textAnchor="middle" fontSize="9" fill="#8b877f">左摇杆</text>
      <g transform={`translate(${rx},${ry})`}>
        {on(11) && <circle cx="292" cy="232" r="35" fill="none" stroke={LIT} strokeWidth="2" opacity=".7" />}
        <circle cx="292" cy="232" r="30" fill="url(#stickWell)" stroke={STROKE} strokeWidth="2" />
        <circle cx="292" cy="232" r="22" fill="#d5d1c8" stroke="#bbb6ad" />
        <circle cx="292" cy="232" r="8" fill="#c5c0b7" />
      </g>
      <text x="292" y="273" textAnchor="middle" fontSize="9" fill="#8b877f">右摇杆</text>

      {/* dpad */}
      <g>
        <rect x="169" y="228" width="13" height="34" rx="3" fill={on(12) || on(13) ? LIT : BODY_2} stroke={STROKE} />
        <rect x="158" y="239" width="35" height="13" rx="3" fill={on(14) || on(15) ? LIT : BODY_2} stroke={STROKE} />
      </g>

      {/* face buttons */}
      {face(336, 166, 'Y', 3)}
      {face(320, 184, 'X', 2)}
      {face(352, 184, 'B', 1)}
      {face(336, 202, 'A', 0)}

      {/* back/start */}
      <circle cx="191" cy="190" r="9" fill={on(8) ? LIT : '#dedad2'} stroke={STROKE} />
      <circle cx="249" cy="190" r="9" fill={on(9) ? LIT : '#dedad2'} stroke={STROKE} />
    </svg>
  );
}

function PSGraphic({ buttons, axes, triggers }: Omit<Props, 'type'>) {
  const lx = (axes[0] ?? 0) * 17;
  const ly = (axes[1] ?? 0) * 17;
  const rx = (axes[2] ?? 0) * 17;
  const ry = (axes[3] ?? 0) * 17;
  const on = (i: number) => buttons[i] === true;
  const face = (cx: number, cy: number, shape: 'triangle' | 'circle' | 'cross' | 'square', i: number) => {
    const fill = on(i) ? LIT : '#e3dfd7';
    const stroke = on(i) ? '#fff' : '#8b877f';
    return (
      <g>
        <circle cx={cx} cy={cy} r="13" fill={fill} stroke={STROKE} />
        {shape === 'triangle' && <path d={`M${cx} ${cy - 6}l6 11h-12Z`} fill="none" stroke={stroke} strokeWidth="1.6" />}
        {shape === 'circle' && <circle cx={cx} cy={cy} r="5" fill="none" stroke={stroke} strokeWidth="1.6" />}
        {shape === 'cross' && <path d={`M${cx - 5} ${cy - 5}l10 10M${cx + 5} ${cy - 5}l-10 10`} stroke={stroke} strokeWidth="1.6" />}
        {shape === 'square' && <rect x={cx - 5} y={cy - 5} width="10" height="10" fill="none" stroke={stroke} strokeWidth="1.6" />}
      </g>
    );
  };
  return (
    <svg className="pad-svg" viewBox="0 0 460 383" role="img" aria-label="PlayStation 手柄示意图">
      <Shadow />
      {/* body */}
      <g filter="url(#controlShadow)">
        <path d="M95 130c10-32 38-46 75-46h120c37 0 65 14 75 46l30 122c8 34-25 61-57 45-17-8-30-25-47-42l-25-30c-10-12-22-16-41-16h-43c-19 0-31 4-41 16l-25 30c-17 17-30 34-47 42-32 16-65-11-57-45Z" fill="url(#controllerBody)" stroke={STROKE} strokeWidth="2.4" />
        <path d="M142 176c30-16 146-16 176 0l16 90c5 31-16 52-48 52h-112c-32 0-53-21-48-52Z" fill="url(#controllerBody)" />
      </g>
      {/* touchpad */}
      <rect x="171" y="108" width="118" height="57" rx="10" fill="#f4f1eb" stroke="#aaa59b" strokeWidth="2" />
      <path d="M186 121h88" stroke="rgba(255,255,255,.8)" strokeWidth="2" />
      <text x="230" y="177" textAnchor="middle" fontSize="9" fill="#9a958b">TOUCHPAD</text>

      {/* shoulder / trigger */}
      <path d="M99 95c4-19 16-28 32-28h24c9 0 15 7 15 16v20c0 8-4 12-11 12h-43c-12 0-19-8-17-20Z" fill={on(4) ? LIT : BODY_2} stroke={STROKE} strokeWidth="2" />
      <text x="134" y="111" textAnchor="middle" fontSize="10" fill={on(4) ? '#fff' : '#8b877f'}>L1</text>
      <path d="M361 95c-4-19-16-28-32-28h-24c-9 0-15 7-15 16v20c0 8 4 12 11 12h43c12 0 19-8 17-20Z" fill={on(5) ? LIT : BODY_2} stroke={STROKE} strokeWidth="2" />
      <text x="326" y="111" textAnchor="middle" fontSize="10" fill={on(5) ? '#fff' : '#8b877f'}>R1</text>
      <rect x="82" y="120" width="70" height="9" rx="4.5" fill="#d7d3ca" stroke={STROKE} />
      <rect x="84" y="122" width={(66 * Math.min(1, triggers[0] ?? 0)).toFixed(1)} height="5" rx="2.5" fill={LIT} opacity=".75" />
      <rect x="308" y="120" width="70" height="9" rx="4.5" fill="#d7d3ca" stroke={STROKE} />
      <rect x="310" y="122" width={(66 * Math.min(1, triggers[1] ?? 0)).toFixed(1)} height="5" rx="2.5" fill={LIT} opacity=".75" />

      {/* d-pad */}
      <g>
        <rect x="135" y="203" width="12" height="34" rx="3" fill={on(12) || on(13) ? LIT : BODY_2} stroke={STROKE} />
        <rect x="124" y="214" width="34" height="12" rx="3" fill={on(14) || on(15) ? LIT : BODY_2} stroke={STROKE} />
      </g>

      {/* face buttons */}
      {face(330, 190, 'triangle', 3)}
      {face(316, 207, 'square', 2)}
      {face(344, 207, 'circle', 1)}
      {face(330, 224, 'cross', 0)}

      {/* sticks */}
      <g transform={`translate(${lx},${ly})`}>
        <circle cx="190" cy="286" r="30" fill="url(#stickWell)" stroke={STROKE} strokeWidth="2" />
        <circle cx="190" cy="286" r="22" fill="#d5d1c8" stroke="#bbb6ad" />
        <circle cx="190" cy="286" r="8" fill="#c5c0b7" />
      </g>
      <g transform={`translate(${rx},${ry})`}>
        <circle cx="270" cy="286" r="30" fill="url(#stickWell)" stroke={STROKE} strokeWidth="2" />
        <circle cx="270" cy="286" r="22" fill="#d5d1c8" stroke="#bbb6ad" />
        <circle cx="270" cy="286" r="8" fill="#c5c0b7" />
      </g>

      {/* PS / create / options */}
      <circle cx="230" cy="230" r="8" fill={on(16) ? LIT : '#dedad2'} stroke={STROKE} />
      <rect x="184" y="218" width="12" height="5" rx="2.5" fill={on(8) ? LIT : '#dedad2'} stroke={STROKE} />
      <rect x="264" y="218" width="12" height="5" rx="2.5" fill={on(9) ? LIT : '#dedad2'} stroke={STROKE} />
    </svg>
  );
}

function SwitchGraphic({ buttons }: Omit<Props, 'type'>) {
  const on = (i: number) => buttons[i] === true;
  return (
    <svg className="pad-svg" viewBox="0 0 400 330" role="img" aria-label="Switch Joy-Con 示意图">
      <Shadow />
      <g filter="url(#controlShadow)">
        <rect x="62" y="28" width="86" height="250" rx="38" fill="#00c3e3" stroke="rgba(0,0,0,.18)" />
        <rect x="252" y="28" width="86" height="250" rx="38" fill="#ff4b48" stroke="rgba(0,0,0,.18)" />
        <rect x="144" y="42" width="112" height="222" rx="12" fill="#14161a" stroke="#2a2d34" />
      </g>
      <text x="105" y="48" textAnchor="middle" fontSize="10" fill="rgba(0,0,0,.55)">−</text>
      <text x="295" y="48" textAnchor="middle" fontSize="13" fill="rgba(255,255,255,.9)">+</text>

      {/* left stick + dpad */}
      <circle cx="105" cy="118" r="23" fill="#1a1c1f" />
      <circle cx="105" cy="118" r="16" fill="#2a2d31" stroke="#555" />
      <g>
        <rect x="90" y="174" width="12" height="34" rx="3" fill={on(12) || on(13) ? LIT : '#d8d5ce'} />
        <rect x="79" y="185" width="34" height="12" rx="3" fill={on(14) || on(15) ? LIT : '#d8d5ce'} />
      </g>
      <circle cx="105" cy="247" r="7" fill="#101114" />

      {/* right stick + face buttons */}
      <circle cx="295" cy="214" r="23" fill="#1a1c1f" />
      <circle cx="295" cy="214" r="16" fill="#2a2d31" stroke="#555" />
      <g>
        <circle cx="295" cy="108" r="11" fill={on(3) ? LIT : '#e8e5df'} />
        <text x="295" y="112" textAnchor="middle" fontSize="10" fill="#77736c">X</text>
        <circle cx="317" cy="130" r="11" fill={on(0) ? LIT : '#e8e5df'} />
        <text x="317" y="134" textAnchor="middle" fontSize="10" fill="#77736c">A</text>
        <circle cx="273" cy="130" r="11" fill={on(1) ? LIT : '#e8e5df'} />
        <text x="273" y="134" textAnchor="middle" fontSize="10" fill="#77736c">B</text>
        <circle cx="295" cy="152" r="11" fill={on(2) ? LIT : '#e8e5df'} />
        <text x="295" y="156" textAnchor="middle" fontSize="10" fill="#77736c">Y</text>
      </g>
      <rect x="108" y="28" width="20" height="7" rx="3" fill="rgba(255,255,255,.55)" />
      <rect x="272" y="28" width="20" height="7" rx="3" fill="rgba(255,255,255,.55)" />
      <text x="200" y="306" textAnchor="middle" fontSize="10" fill="#8b877f">Joy-Con 双手</text>
    </svg>
  );
}

export function ControllerGraphic({ type, buttons, axes, triggers }: Props) {
  if (type === 'playstation') {
    return <PSGraphic buttons={buttons} axes={axes} triggers={triggers} />;
  }
  if (type === 'switch') {
    return <SwitchGraphic buttons={buttons} axes={axes} triggers={triggers} />;
  }
  return <XboxGraphic buttons={buttons} axes={axes} triggers={triggers} />;
}
