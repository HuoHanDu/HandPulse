// @ts-nocheck
/* 手脉 HandPulse · 共用 Mock 数据与 104 键位坐标
 * 三方向必须整段内联进 HTML，保证同一份数据、同一套坐标。
 * 数据自洽说明：今日按键 12,438 + 今日点击 5,204 = 今日动作 17,642。
 * 键盘页 Top10 占比 = 该键次数 / 按键总数；侧栏大数字 = 今日动作总数。
 */
export const HP: any = (function () {
  var NOW_MIN = 21 * 60 + 43;            // 21:43
  var KEY_TOTAL = 12438;
  var CLICK_TOTAL = 5204;

  /* ---------- 每个物理键的今日次数（和 = 12,438） ---------- */
  var counts = {
    W: 1204, A: 986, D: 921, Space: 878, LShift: 764, E: 703, Q: 641, R: 588, LCtrl: 552, S: 497,
    Tab: 132, X: 118, C: 104, V: 96, Z: 88, B: 82, F: 79, G: 74, T: 68, Y: 41, U: 34, I: 24, O: 22, P: 19,
    H: 39, N: 37, J: 33, M: 31, K: 28, L: 26,
    '1': 62, '2': 54, '3': 48, '4': 44, '5': 21, '6': 18, '7': 16, '8': 14, '9': 12, '0': 11,
    '-': 14, '=': 13, '[': 11, ']': 10, '\\': 9, ';': 13, "'": 8, ',': 16, '.': 19, '/': 15, '`': 4,
    Esc: 37, Enter: 41, RShift: 26, LAlt: 33, RAlt: 10, LWin: 9, RWin: 6, Menu: 4, RCtrl: 12,
    Backspace: 46, Caps: 12, Up: 18, Down: 24, Left: 29, Right: 31,
    Ins: 3, Home: 6, PgUp: 8, Del: 5, End: 7, PgDn: 9, PrtSc: 2, ScrLk: 1, Pause: 1,
    F1: 2, F2: 3, F3: 1, F4: 1, F5: 2, F6: 1, F7: 1, F8: 1, F9: 1, F10: 1, F11: 0, F12: 0,
    NumLock: 2, NDiv: 1, NMul: 2, NSub: 1, NAdd: 3, NEnter: 4, N0: 2, N1: 3, N2: 2, N3: 1,
    N4: 2, N5: 1, N6: 1, N7: 1, N8: 1, N9: 1, NDot: 1,
    /* 剩余零散键补齐到 12,438 */
    'F13': 0
  };
  var labels = Object.keys(counts);
  // 前 10 名保持设定值（W 1,204 / 9.7% 与需求文档一致），其余键按比例缩放到总数 12,438
  var initial = labels.map(function (k) { return { label: k, count: counts[k] }; })
    .sort(function (a, b) { return b.count - a.count; });
  var topSet = {};
  initial.slice(0, 10).forEach(function (x) { topSet[x.label] = true; });
  var topSum = initial.slice(0, 10).reduce(function (a, b) { return a + b.count; }, 0);
  var restLabels = labels.filter(function (k) { return !topSet[k]; });
  var restSum = restLabels.reduce(function (a, k) { return a + counts[k]; }, 0);
  var restFactor = restSum > 0 ? (KEY_TOTAL - topSum) / restSum : 1;
  restLabels.forEach(function (k) { counts[k] = Math.round(counts[k] * restFactor); });
  var nowSum = labels.reduce(function (a, k) { return a + counts[k]; }, 0);
  var fix = KEY_TOTAL - nowSum;
  if (fix !== 0) {
    restLabels.sort(function (a, b) { return counts[b] - counts[a]; });
    counts[restLabels[0]] = Math.max(0, counts[restLabels[0]] + fix);
  }

  var sorted = labels.map(function (k) { return { label: k, count: counts[k], ratio: counts[k] / KEY_TOTAL }; })
    .sort(function (a, b) { return b.count - a.count; });

  /* ---------- 今日每分钟（0–1440；21:43 之后无记录 = null） ---------- */
  function bell(x, c, w) { var t = (x - c) / w; return Math.exp(-t * t); }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  var raw = [];
  for (var m = 0; m < 1440; m++) {
    var h = m / 60;
    var v = 0.8;
    v += 24 * smooth(8.6, 10.2, h) * (1 - smooth(17.0, 18.8, h));      // 白天办公
    v -= 15 * bell(h, 12.55, 0.55);                                     // 午休低谷
    v += 150 * bell(h, 20.55, 1.35) * (h > 18.4 ? 1 : 0.15);            // 晚间高峰
    v += 26 * bell(h, 0.25, 0.9);                                       // 深夜小高峰
    v += 12 * bell(h, 15.2, 0.35);                                      // 下午短爆发
    v *= 1 + 0.10 * Math.sin(m * 0.37) + 0.06 * Math.sin(m * 1.13);     // 稳定噪声
    if (h >= 2 && h < 6.5) v *= 0.08;
    v += 560 * bell(m, 21 * 60 + 3, 1.7);                               // 21:03 高峰爆发
    raw.push(Math.max(0, v));
  }
  var rawSum = raw.reduce(function (a, b) { return a + b; }, 0);
  var keyMin = raw.map(function (v, i) { return i <= NOW_MIN ? Math.round(v / rawSum * KEY_TOTAL) : null; });
  // 修正累计误差
  var cur = keyMin.reduce(function (a, v) { return a + (v || 0); }, 0);
  var diff = KEY_TOTAL - cur;
  for (var i = 0; diff !== 0 && i < 1440; i++) {
    if (keyMin[i] == null) continue;
    var step = diff > 0 ? 1 : -1;
    if (keyMin[i] + step >= 0) { keyMin[i] += step; diff -= step; }
  }

  /* ---------- 今日每分钟点击（和 = 5,204） ---------- */
  var crawl = [];
  for (var j = 0; j < 1440; j++) {
    var hh = j / 60;
    var c = 0.9 + 7 * bell(hh, 20.7, 1.6) + 2.4 * smooth(9, 11, hh) * (1 - smooth(16.5, 18.5, hh)) + 1.2 * bell(hh, 15.3, 0.6);
    c *= 1 + 0.15 * Math.sin(j * 0.23);
    if (hh < 7) c *= 0.2;
    c += 92 * bell(j, 21 * 60 + 3, 1.7);
    crawl.push(Math.max(0, c));
  }
  var crawlSum = crawl.reduce(function (a, b) { return a + b; }, 0);
  var clickMin = crawl.map(function (v, k) { return k <= NOW_MIN ? Math.round(v / crawlSum * CLICK_TOTAL) : null; });
  var ccur = clickMin.reduce(function (a, v) { return a + (v || 0); }, 0);
  var cdiff = CLICK_TOTAL - ccur;
  for (var q = 0; cdiff !== 0 && q < 1440; q++) {
    if (clickMin[q] == null) continue;
    var st = cdiff > 0 ? 1 : -1;
    if (clickMin[q] + st >= 0) { clickMin[q] += st; cdiff -= st; }
  }

  function hourSum(arr) {
    var out = [];
    for (var h = 0; h < 24; h++) {
      var s = 0;
      for (var m2 = h * 60; m2 < h * 60 + 60; m2++) s += (arr[m2] || 0);
      out.push(s);
    }
    return out;
  }
  var keyHour = hourSum(keyMin);
  var clickHour = hourSum(clickMin);
  var apmHour = keyHour.map(function (v, k) { return v + clickHour[k]; });

  var peak = { value: 0, minute: 0 };
  for (var p = 0; p <= NOW_MIN; p++) {
    var a = (keyMin[p] || 0) + (clickMin[p] || 0);
    if (a > peak.value) peak.value = a, peak.minute = p;
  }

  /* ---------- 7 天 / 30 天 ---------- */
  var dayTotals = [9842, 14208, 12438, 7136, 18402, 21684, 13220]; // 周一…周日（今日周三）
  var weekKey = dayTotals.map(function (t, d) { return Math.round(t * 0.78); });
  var weekClick = dayTotals.map(function (t, d) { return t - Math.round(t * 0.78); });
  var weekLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var weekDates = ['10/29', '10/30', '10/31', '11/01', '11/02', '11/03', '11/04'];
  // 近 30 天（含今日）
  var days30 = [];
  for (var d30 = 29; d30 >= 0; d30--) {
    var dt = new Date(2026, 10, 4); dt.setDate(dt.getDate() - d30);
    var seed = Math.sin(d30 * 12.9898) * 43758.5453;
    var r = seed - Math.floor(seed);
    var base = 11000 + r * 9000;
    if (dt.getDay() === 0 || dt.getDay() === 6) base *= 1.35;
    var value = d30 === 0 ? 12438 : Math.round(base);
    days30.push({
      date: (dt.getMonth() + 1) + '/' + dt.getDate(),
      iso: dt.toISOString().slice(0, 10),
      actions: value, keys: Math.round(value * 0.78), clicks: value - Math.round(value * 0.78)
    });
  }

  /* ---------- 7×24 热力（平均动作数/分钟） ---------- */
  var weekHeat = [];
  for (var wd = 0; wd < 7; wd++) {
    var row = [];
    for (var hh2 = 0; hh2 < 24; hh2++) {
      var v2 = apmHour[hh2] / 60;
      if (wd >= 5) v2 *= 1.25;
      if (wd === 2) v2 *= 0.92;
      row.push(Math.round(v2 * 10) / 10);
    }
    weekHeat.push(row);
  }
  var weekHeatMax = Math.max.apply(null, weekHeat.map(function (r) { return Math.max.apply(null, r); }));

  /* ---------- 日历热力（53×7，共 371 天，今日高亮） ---------- */
  var calendar = [];
  for (var cd = 370; cd >= 0; cd--) {
    var date = new Date(2026, 10, 4); date.setDate(date.getDate() - cd);
    var sd = Math.sin((cd + 1) * 78.233) * 43758.5453;
    var rr = sd - Math.floor(sd);
    var val = Math.round(700 + rr * rr * 24000);
    if (date.getDay() === 0 || date.getDay() === 6) val = Math.round(val * 1.3);
    if (cd === 0) val = 12438;
    calendar.push({ iso: date.toISOString().slice(0, 10), v: val });
  }
  var calMax = Math.max.apply(null, calendar.map(function (d) { return d.v; }));

  /* ---------- 直方 ---------- */
  var top20 = sorted.slice(0, 20).map(function (x) { return { label: x.label, count: x.count }; });
  var gaps = [
    { label: '<50', value: 3120 }, { label: '50–100', value: 1980 },
    { label: '100–200', value: 1436 }, { label: '200–500', value: 684 }, { label: '>500', value: 214 }
  ];

  /* ---------- 鼠标 ---------- */
  var clicks = { left: 3204, right: 1872, middle: 12, side1: 88, side2: 28 };
  clicks.total = clicks.left + clicks.right + clicks.middle + clicks.side1 + clicks.side2; // 5,204
  var grid = [];
  for (var gy = 0; gy < 18; gy++) {
    for (var gx = 0; gx < 32; gx++) {
      var nx = gx / 31, ny = gy / 17;
      var s = 0;
      s += 1.00 * Math.exp(-(((nx - 0.52) / 0.11) ** 2 + ((ny - 0.62) / 0.11) ** 2)); // 准星区
      s += 0.55 * Math.exp(-(((nx - 0.47) / 0.20) ** 2 + ((ny - 0.44) / 0.14) ** 2));
      s += 0.30 * Math.exp(-(((nx - 0.84) / 0.06) ** 2 + ((ny - 0.16) / 0.08) ** 2)); // 小地图
      s += 0.18 * Math.exp(-(((nx - 0.08) / 0.08) ** 2 + ((ny - 0.10) / 0.06) ** 2)); // 菜单
      s += 0.05 * Math.exp(-(((nx - 0.22) / 0.12) ** 2 + ((ny - 0.78) / 0.10) ** 2));
      if (s > 0.035) grid.push({ x: gx, y: gy, v: s });
    }
  }
  var gsum = grid.reduce(function (a, g) { return a + g.v; }, 0);
  grid.forEach(function (g) { g.v = Math.round(g.v / gsum * CLICK_TOTAL); });
  var gridMax = Math.max.apply(null, grid.map(function (g) { return g.v; }));

  var wheelHour = apmHour.map(function (v, k) { return Math.round(v * 0.10); });
  var moveHour = apmHour.map(function (v, k) { return Math.round(v * 0.22); });

  /* ---------- 104 键位坐标（单位 u；键帽视觉宽 = w*u - 3，位置 = x*u） ---------- */
  function K(label, x, y, w, h) { return { id: label, label: label, x: x, y: y, w: w || 1, h: h || 1 }; }
  var keys = [];
  // 功能行
  keys.push(K('Esc', 0, 0));
  var fxs = [2, 3, 4, 5, 6.5, 7.5, 8.5, 9.5, 11, 12, 13, 14];
  for (var f = 0; f < 12; f++) keys.push(K('F' + (f + 1), fxs[f], 0));
  keys.push(K('PrtSc', 16.5, 0), K('ScrLk', 17.5, 0), K('Pause', 18.5, 0));
  // 数字行
  var row1 = ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
  row1.forEach(function (l, i) { keys.push(K(l, i, 1)); });
  keys.push(K('Backspace', 13, 1, 2), K('Ins', 16.5, 1), K('Home', 17.5, 1), K('PgUp', 18.5, 1));
  // QWERTY
  keys.push(K('Tab', 0, 2, 1.5));
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'].forEach(function (l, i) { keys.push(K(l, 1.5 + i, 2)); });
  keys.push(K('\\', 13.5, 2, 1.5), K('Del', 16.5, 2), K('End', 17.5, 2), K('PgDn', 18.5, 2));
  // ASDF
  keys.push(K('Caps', 0, 3, 1.75));
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"].forEach(function (l, i) { keys.push(K(l, 1.75 + i, 3)); });
  keys.push(K('Enter', 12.75, 3, 2.25));
  // ZXCV
  keys.push(K('LShift', 0, 4, 2.25));
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'].forEach(function (l, i) { keys.push(K(l, 2.25 + i, 4)); });
  keys.push(K('RShift', 12.25, 4, 2.75), K('↑', 17.5, 4));
  // 底行
  keys.push(K('LCtrl', 0, 5, 1.25), K('LWin', 1.25, 5, 1.25), K('LAlt', 2.5, 5, 1.25),
    K('Space', 3.75, 5, 6.25), K('RAlt', 10, 5, 1.25), K('RWin', 11.25, 5, 1.25),
    K('Menu', 12.5, 5, 1.25), K('RCtrl', 13.75, 5, 1.25),
    K('←', 16.5, 5), K('↓', 17.5, 5), K('→', 18.5, 5));
  // 小键盘
  keys.push(K('NumLock', 20, 1), K('NDiv', 21, 1), K('NMul', 22, 1), K('NSub', 23, 1));
  keys.push(K('N7', 20, 2), K('N8', 21, 2), K('N9', 22, 2), K('NAdd', 23, 2, 1, 2));
  keys.push(K('N4', 20, 3), K('N5', 21, 3), K('N6', 22, 3));
  keys.push(K('N1', 20, 4), K('N2', 21, 4), K('N3', 22, 4), K('NEnter', 23, 4, 1, 2));
  keys.push(K('N0', 20, 5, 2), K('NDot', 22, 5));

  var NUMPAD_LABEL = { NDiv: '/', NMul: '*', NSub: '−', NAdd: '+', NEnter: '↵', NDot: '.', NumLock: 'Num', N0: '0', N1: '1', N2: '2', N3: '3', N4: '4', N5: '5', N6: '6', N7: '7', N8: '8', N9: '9' };
  keys.forEach(function (k) { k.display = NUMPAD_LABEL[k.label] || k.label; k.count = counts[k.label] || 0; });

  return {
    date: '2026-11-04', weekday: '周三', nowLabel: '21:43', nowMinute: NOW_MIN,
    keyTotal: KEY_TOTAL, clickTotal: CLICK_TOTAL, actionTotal: KEY_TOTAL + CLICK_TOTAL,
    keyCounts: counts, keyList: sorted, top10: sorted.slice(0, 10), top8: sorted.slice(0, 8),
    keyHour: keyHour, clickHour: clickHour, apmHour: apmHour,
    perMinute: { keys: keyMin, clicks: clickMin },
    peak: { value: peak.value, minute: peak.minute, label: fmtMin(peak.minute) },
    clicks: clicks, wheel: { up: 1204, down: 986 }, moveKm: 12.4, peakSpeed: 4.2,
    wheelHour: wheelHour, moveHour: moveHour,
    grid: grid, gridMax: gridMax,
    week: { labels: weekLabels, dates: weekDates, totals: dayTotals, keys: weekKey, clicks: weekClick },
    weekHeat: weekHeat, weekHeatMax: weekHeatMax,
    calendar: calendar, calendarMax: calMax,
    days30: days30,
    histogram: { top20: top20, gaps: gaps },
    holds: { avg: 118, max: 3412, keyMax: 'A', keyMaxHold: 3412, keyAvg: 96 },
    keyboard: { keys: keys, widthUnits: 24, heightUnits: 6, u: 40 },
    fmt: { min: fmtMin, n: fmtNum, pct: function (v) { return (v * 100).toFixed(1) + '%'; } }
  };

  function fmtMin(m) { var h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm; }
  function fmtNum(n) { return n.toLocaleString('en-US'); }
})();

/* ---------- UI 常量：热力色阶 / 键名缩写（与原型逐字一致） ---------- */
export const LEVELS = [
  { c: '#101014', ink: '#8e8e93', bd: '#1a1a1d' },
  { c: '#1D3F6B', ink: '#d7e5f5', bd: '#24486f' },
  { c: '#2A6FA8', ink: '#f2f8fc', bd: '#3579b1' },
  { c: '#46A6C4', ink: '#04161c', bd: '#50b0cd' },
  { c: '#8FD06B', ink: '#0d130b', bd: '#9bda78' },
  { c: '#FFC94A', ink: '#17130a', bd: '#ffd268' }
];

export const KEY_LABEL: Record<string, string> = {
  LShift: 'Shift', RShift: 'Shift', LCtrl: 'Ctrl', RCtrl: 'Ctrl', LAlt: 'Alt', RAlt: 'Alt',
  LWin: 'Win', RWin: 'Win', Backspace: 'Bksp', Space: 'Space', Caps: 'Caps', Enter: 'Enter',
  Tab: 'Tab', Esc: 'Esc', PrtSc: 'Prt', ScrLk: 'Scr', Pause: 'Pse', Ins: 'Ins', Del: 'Del',
  Home: 'Home', End: 'End', PgUp: 'PgU', PgDn: 'PgD', Menu: 'Menu'
};

export function displayKey(label: string): string {
  return KEY_LABEL[label] || label;
}