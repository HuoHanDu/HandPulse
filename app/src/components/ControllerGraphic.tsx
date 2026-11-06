interface Props {
  buttons: boolean[];
  axes: number[];
  triggers: number[];
}

/**
 * 手柄示意图。坐标按 Xbox 布局，按键点亮 / 摇杆偏移都直接来自后端 XInput 状态。
 */
export function ControllerGraphic({ buttons, axes, triggers }: Props) {
  const lx = (axes[0] ?? 0) * 24;
  const ly = (axes[1] ?? 0) * 20;
  const rx = (axes[2] ?? 0) * 24;
  const ry = (axes[3] ?? 0) * 20;
  const lt = triggers[0] ?? 0;
  const rt = triggers[1] ?? 0;
  const on = (i: number) => buttons[i] === true;

  const key = (cx: number, cy: number, label: string, active: boolean, color: string) => (
    <g>
      <circle cx={cx} cy={cy} r="21" fill={active ? color : '#20232a'} stroke={active ? color : '#343841'} strokeWidth="2" />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize="16" fontWeight="600" fill={active ? '#06111c' : '#aab1bb'}>{label}</text>
    </g>
  );

  return (
    <svg className="pad-svg" viewBox="0 0 720 360" role="img" aria-label="手柄按键示意图">
      <defs>
        <linearGradient id="padBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1e24" />
          <stop offset="1" stopColor="#0b0c0f" />
        </linearGradient>
        <filter id="padGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* 顶部肩键 / 扳机 */}
      <g>
        <rect x="118" y="52" width="98" height="27" rx="13" fill={on(4) ? '#2997ff' : '#20232a'} stroke="#343841" />
        <text x="167" y="70" textAnchor="middle" fontSize="12" fill={on(4) ? '#001b30' : '#8e969f'}>LB</text>
        <rect x="504" y="52" width="98" height="27" rx="13" fill={on(5) ? '#2997ff' : '#20232a'} stroke="#343841" />
        <text x="553" y="70" textAnchor="middle" fontSize="12" fill={on(5) ? '#001b30' : '#8e969f'}>RB</text>
        <rect x="118" y="84" width="98" height="18" rx="9" fill="#15171c" stroke="#2b2f36" />
        <rect x="120" y="86" width={(94 * Math.min(1, lt)).toFixed(1)} height="14" rx="7" fill="#2997ff" opacity=".9" />
        <text x="167" y="98" textAnchor="middle" fontSize="10" fill="#8e969f">LT</text>
        <rect x="504" y="84" width="98" height="18" rx="9" fill="#15171c" stroke="#2b2f36" />
        <rect x="506" y="86" width={(94 * Math.min(1, rt)).toFixed(1)} height="14" rx="7" fill="#2997ff" opacity=".9" />
        <text x="553" y="98" textAnchor="middle" fontSize="10" fill="#8e969f">RT</text>
      </g>

      {/* 手柄主体 */}
      <path
        d="M190 104 H530 Q610 104 634 174 L666 264 Q682 332 616 342 Q560 350 524 302 L484 246 Q462 226 360 226 Q258 226 236 246 L196 302 Q160 350 104 342 Q38 332 54 264 L86 174 Q110 104 190 104 Z"
        fill="url(#padBody)" stroke="#333841" strokeWidth="2"
      />
      <path d="M128 200 Q82 216 92 282" stroke="#0a0b0d" strokeWidth="18" strokeLinecap="round" opacity=".65" />
      <path d="M592 200 Q638 216 628 282" stroke="#0a0b0d" strokeWidth="18" strokeLinecap="round" opacity=".65" />

      {/* 中央 Home */}
      <circle cx="360" cy="142" r="22" fill={on(16) ? '#2997ff' : '#16181d'} stroke="#333841" />
      <path d="M350 143a12 12 0 0 1 20 0M354 149a7 7 0 0 1 12 0" fill="none" stroke={on(16) ? '#001b30' : '#7f8792'} strokeWidth="2" strokeLinecap="round" />
      <text x="360" y="178" textAnchor="middle" fontSize="10" fill="#6f7680">HOME</text>

      {/* 左摇杆 */}
      <g transform={'translate(' + lx.toFixed(1) + ',' + ly.toFixed(1) + ')'}>
        {on(10) ? <circle cx="252" cy="196" r="40" fill="none" stroke="#2997ff" strokeWidth="2" opacity=".7" /> : null}
        <circle cx="252" cy="196" r="34" fill="#0b0c0f" stroke="#3b4049" strokeWidth="2" />
        <circle cx="252" cy="196" r="26" fill="#1c2027" stroke="#4a505b" />
        <circle cx="252" cy="196" r="10" fill="#2f353e" />
      </g>
      <text x="252" y="248" textAnchor="middle" fontSize="10" fill="#6f7680">左摇杆</text>

      {/* 右摇杆 */}
      <g transform={'translate(' + rx.toFixed(1) + ',' + ry.toFixed(1) + ')'}>
        {on(11) ? <circle cx="468" cy="196" r="40" fill="none" stroke="#2997ff" strokeWidth="2" opacity=".7" /> : null}
        <circle cx="468" cy="196" r="34" fill="#0b0c0f" stroke="#3b4049" strokeWidth="2" />
        <circle cx="468" cy="196" r="26" fill="#1c2027" stroke="#4a505b" />
        <circle cx="468" cy="196" r="10" fill="#2f353e" />
      </g>
      <text x="468" y="248" textAnchor="middle" fontSize="10" fill="#6f7680">右摇杆</text>

      {/* 十字键 */}
      <g>
        <rect x="236" y="258" width="18" height="18" rx="4" fill={on(12) ? '#2997ff' : '#242830'} />
        <rect x="236" y="294" width="18" height="18" rx="4" fill={on(13) ? '#2997ff' : '#242830'} />
        <rect x="218" y="276" width="18" height="18" rx="4" fill={on(14) ? '#2997ff' : '#242830'} />
        <rect x="254" y="276" width="18" height="18" rx="4" fill={on(15) ? '#2997ff' : '#242830'} />
        <circle cx="245" cy="285" r="3" fill="#3a4049" />
      </g>
      <text x="245" y="330" textAnchor="middle" fontSize="10" fill="#6f7680">方向键</text>

      {/* ABXY */}
      <g>
        {key(506, 170, 'Y', on(3), '#f5c542')}
        {key(476, 200, 'X', on(2), '#4c8dff')}
        {key(536, 200, 'B', on(1), '#ff5c5c')}
        {key(506, 230, 'A', on(0), '#35d0a5')}
      </g>

      {/* Back / Start */}
      <g>
        <circle cx="310" cy="170" r="12" fill={on(8) ? '#2997ff' : '#20232a'} stroke="#343841" />
        <circle cx="410" cy="170" r="12" fill={on(9) ? '#2997ff' : '#20232a'} stroke="#343841" />
        <text x="310" y="194" textAnchor="middle" fontSize="9" fill="#6f7680">BACK</text>
        <text x="410" y="194" textAnchor="middle" fontSize="9" fill="#6f7680">START</text>
      </g>
    </svg>
  );
}
