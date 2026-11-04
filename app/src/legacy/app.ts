// @ts-nocheck
// 原型应用脚本原样保留（内部 IIFE 通过 window.HP 取数）。
(function () {
  'use strict';
  var HP = window.HP;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var nf = HP.fmt.n, pf = HP.fmt.pct, clk = HP.fmt.min;
  var NOW = HP.nowMinute;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var state = {
    route: 'keyboard',
    range: { keyboard: 'today', mouse: 'today', stats: 'today', settings: 'today' },
    disp: 'all', layout: 104, sel: 'A', hover: null,
    paused: false, pausedAt: 0, empty: false, viewReset: false,
    layer: 'clicks', cell: null, hist: 'top20', heat: 'week', page: 0,
    u: 40, granularity: 60, retention: 30, autoStart: true
  };

  var LEVELS = [
    { c: '#101014', ink: '#8e8e93', bd: '#1a1a1d' },
    { c: '#1D3F6B', ink: '#d7e5f5', bd: '#24486f' },
    { c: '#2A6FA8', ink: '#f2f8fc', bd: '#3579b1' },
    { c: '#46A6C4', ink: '#04161c', bd: '#50b0cd' },
    { c: '#8FD06B', ink: '#0d130b', bd: '#9bda78' },
    { c: '#FFC94A', ink: '#17130a', bd: '#ffd268' }
  ];

  var TITLES = { keyboard: '键盘', mouse: '鼠标', stats: '数据', settings: '设置' };
  var SUBS = { keyboard: '键位 · A', mouse: '点击分布', stats: '图表摘要', settings: '采集与存储' };
  var RANGE_OPTS = {
    keyboard: [['session', '本次'], ['today', '今日'], ['week', '7 天']],
    mouse: [['session', '本次'], ['today', '今日'], ['week', '7 天']],
    stats: [['today', '今日'], ['week', '7 天'], ['month', '30 天']],
    settings: [['session', '本次'], ['today', '今日'], ['week', '7 天']]
  };

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += (a[i] || 0); return s; }
  function sliceSum(arr, a, b) { var s = 0; for (var i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) s += (arr[i] || 0); return s; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ---------------- ranges ---------------- */
  function keyRange() {
    var id = state.ranges ? null : null;
    id = state.range.keyboard;
    if (id === 'session') { var t = sliceSum(HP.perMinute.keys, NOW - 29, NOW); return { factor: t / HP.keyTotal, total: t, label: '本次' }; }
    if (id === 'week') { var w = sum(HP.week.keys); return { factor: w / HP.keyTotal, total: w, label: '7 天' }; }
    return { factor: 1, total: HP.keyTotal, label: '今日' };
  }
  function mouseRange() {
    var id = state.range.mouse;
    if (id === 'session') { var t = sliceSum(HP.perMinute.clicks, NOW - 29, NOW); return { factor: t / HP.clickTotal, total: t, label: '本次' }; }
    if (id === 'week') { var w = sum(HP.week.clicks); return { factor: w / HP.clickTotal, total: w, label: '7 天' }; }
    return { factor: 1, total: HP.clickTotal, label: '今日' };
  }
  function keyCount(label) {
    if (state.empty || state.viewReset) return 0;
    return Math.round((HP.keyCounts[label] || 0) * keyRange().factor);
  }
  function keyTotalCur() { return (state.empty || state.viewReset) ? 0 : keyRange().total; }
  function maxKeyCount() {
    if (state.empty || state.viewReset) return 0;
    return Math.round(HP.top10[0].count * keyRange().factor);
  }
  function levelOf(count) {
    if (!count) return 0;
    var max = maxKeyCount();
    if (!max) return 0;
    var r = count / max;
    if (r > 0.75) return 5;
    if (r > 0.45) return 4;
    if (r > 0.2) return 3;
    if (r > 0.05) return 2;
    return 1;
  }
  function levelByMax(count, max) {
    if (!count || !max) return 0;
    var r = count / max;
    if (r > 0.75) return 5;
    if (r > 0.45) return 4;
    if (r > 0.2) return 3;
    if (r > 0.05) return 2;
    return 1;
  }

  /* ---------------- routing ---------------- */
  function parseRoute() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return TITLES[h] ? h : 'keyboard';
  }
  function applyRoute(route) {
    state.route = route;
    document.body.setAttribute('data-route', route);
    $$('.rail-btn').forEach(function (a) {
      if (a.getAttribute('data-r') === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#tpTitle').textContent = TITLES[route];
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-page') === route); });
    renderRangeSeg();
    $('#inspSub').textContent = route === 'keyboard' && state.sel && !state.empty && !state.viewReset ? '键位 · ' + state.sel : SUBS[route];
    $('#inspX').hidden = !(route === 'keyboard' && state.sel && !state.empty && !state.viewReset);
    if (route === 'keyboard') { layoutKeyboard(); renderKeyboard(); }
    if (route === 'mouse') { renderMouse(); }
    if (route === 'stats') { renderStats(); }
    if (route === 'settings') { renderSettings(); }
    renderInspector();
    updateMasks();
    drawTape();
  }

  function renderRangeSeg() {
    var box = $('#rangeSeg');
    if (state.route === 'settings') {
      box.className = 'seg';
      box.innerHTML = '<span class="tp-static">全部时间</span>';
      box.style.border = '0';
      return;
    }
    box.style.border = '';
    var opts = RANGE_OPTS[state.route] || RANGE_OPTS.keyboard;
    var cur = state.range[state.route];
    box.innerHTML = opts.map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '">' + o[1] + '</button>';
    }).join('');
  }

  /* ---------------- transport / pause ---------------- */
  function setPaused(p) {
    state.paused = p;
    state.pausedAt = p ? Date.now() : 0;
    var swCollect = $('#swCollect'); if (swCollect) swCollect.setAttribute('aria-checked', String(!p));
    $('#statusBtn').setAttribute('aria-pressed', String(p));
    $('#pauseBtn').setAttribute('aria-pressed', String(p));
    var dot = $('#statusDot'), railDot = $('#railDot');
    dot.classList.toggle('is-paused', p);
    railDot.classList.toggle('is-paused', p);
    railDot.title = p ? '采集已暂停' : '采集运行中';
    $('#statusText').textContent = p ? '已暂停' : '运行中';
    $('#tape').classList.toggle('is-paused', p);
    $('#pauseBtn').innerHTML = p
      ? '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.6" height="12" rx="1"/><rect x="9.4" y="2" width="3.6" height="12" rx="1"/></svg>';
    $('#pauseBtn').setAttribute('aria-label', p ? '恢复记录' : '暂停记录');
    $('#pauseBtn').title = p ? '恢复记录' : '暂停记录';
    $('#statusBtn').title = p ? '恢复记录' : '暂停记录';
    updateMasks();
  }
  function pauseLabel() {
    if (!state.paused) return '';
    var s = Math.floor((Date.now() - state.pausedAt) / 1000);
    return '已暂停 ' + Math.floor(s / 60) + ':' + pad2(s % 60) + '，恢复后继续写入。';
  }
  function updateMasks() {
    var paused = state.paused;
    $('#roActions').textContent = nf(state.empty ? 0 : HP.actionTotal);
    $('#roKeys').textContent = nf(state.empty ? 0 : HP.keyTotal);
    $('#roClicks').textContent = nf(state.empty ? 0 : HP.clickTotal);
    var kb = $('#kbMask');
    if (state.route === 'keyboard' && (paused || state.empty)) {
      kb.hidden = false;
      $('#kbMaskTitle').textContent = paused ? '记录已暂停' : '还没有记录到按键 —— 敲几个键试试';
      $('#kbMaskNote').textContent = paused ? pauseLabel() : '示例数据已清空。';
      $('#kbMaskBtn').textContent = paused ? '恢复采集' : '恢复演示数据';
      $('#kbMaskBtn').dataset.action = paused ? 'resume' : 'restore';
    } else kb.hidden = true;
    $('#mouseMask').hidden = !(state.route === 'mouse' && state.empty);
    $('#statsMask').hidden = !(state.route === 'stats' && state.empty);
    $('#emptyBanner').hidden = !state.empty;
  }

  /* ---------------- tape ---------------- */
  var tapeCells = [];
  var rng = 20261104;
  function rnd() { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 4294967296; }
  var CELLS = 600;
  function initTape() {
    tapeCells = [];
    var rate = ((HP.perMinute.keys[NOW] || 0) + (HP.perMinute.clicks[NOW] || 0));
    for (var i = 0; i < CELLS; i++) {
      tapeCells.push({ ev: rnd() < rate / CELLS ? 0.45 + rnd() * 0.55 : 0, idle: 0.05 + rnd() * 0.06 });
    }
  }
  function drawTape() {
    var cv = $('#tapeCanvas');
    if (!cv) return;
    var box = cv.getBoundingClientRect();
    if (!box.width) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.max(1, Math.round(box.width)), H = Math.max(1, Math.round(box.height));
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    var g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var mid = H / 2;
    var cw = W / CELLS;
    // 100ms 标尺：上沿每 0.5 秒一小格、每 5 秒一大格
    for (var t = 0; t < CELLS; t += 5) {
      var x0 = Math.round(t * cw);
      var big = (t % 50 === 0);
      g.fillStyle = big ? '#2d333d' : '#1d2229';
      g.fillRect(x0, big ? 1 : 3, 1, big ? 5 : 2);
      g.fillRect(x0, H - (big ? 6 : 5), 1, big ? 5 : 2);
    }
    g.fillStyle = '#232831';
    g.fillRect(0, Math.round(mid), W, 1);
    for (var i = 0; i < CELLS; i++) {
      var c = tapeCells[i];
      if (!c) continue;
      var amp = c.ev ? c.ev : c.idle;
      var h = Math.max(0.7, amp * 10);
      g.fillStyle = c.ev ? 'rgba(226,234,245,' + (0.6 + 0.4 * c.ev).toFixed(2) + ')' : 'rgba(154,168,186,0.3)';
      g.fillRect(i * cw, mid - h, Math.max(1, cw - 0.35), h * 2);
    }
    g.fillStyle = '#4c8dff';
    g.fillRect(W - 2, 0, 2, H);
    g.fillRect(W - 2, 0, 2, 3);
  }

  /* ---------------- keyboard ---------------- */
  var keyEls = {};
  var KEY_LABEL = {
    LShift: 'Shift', RShift: 'Shift', LCtrl: 'Ctrl', RCtrl: 'Ctrl', LAlt: 'Alt', RAlt: 'Alt',
    LWin: 'Win', RWin: 'Win', Backspace: 'Bksp', Space: 'Space', Caps: 'Caps', Enter: 'Enter',
    Tab: 'Tab', Esc: 'Esc', PrtSc: 'Prt', ScrLk: 'Scr', Pause: 'Pse', Ins: 'Ins', Del: 'Del',
    Home: 'Home', End: 'End', PgUp: 'PgU', PgDn: 'PgD', Menu: 'Menu'
  };
  function layoutKeyboard() {
    var stage = $('#kbstage');
    if (!stage) return;
    var avail = stage.clientWidth - 20;
    var u = Math.max(29, Math.min(41, Math.floor(avail / 24)));
    state.u = u;
    var lbl = u >= 34 ? 12 : 11;
    document.documentElement.style.setProperty('--keylabel', lbl + 'px');
  }
  function keyPos(label) {
    var ks = HP.keyboard.keys;
    for (var i = 0; i < ks.length; i++) {
      if (ks[i].label === label) {
        var row = Math.round(ks[i].y) + 1;
        var col = 1;
        for (var j = 0; j < ks.length; j++) if (Math.round(ks[j].y) === Math.round(ks[i].y) && ks[j].x < ks[i].x) col++;
        return { row: row, col: col };
      }
    }
    return { row: 0, col: 0 };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }
  function keyTimes(label) {
    if (label === 'A') return ['09:12', '21:41'];
    var h = hashStr(label);
    var first = 8 * 60 + 34 + (h % 46);
    var last = NOW - 2 - (Math.floor(h / 97) % 14);
    if (first > last - 30) first = Math.max(0, last - 30);
    return [clk(first), clk(last)];
  }
  function rankOf(label) {
    for (var i = 0; i < HP.keyList.length; i++) if (HP.keyList[i].label === label) return i + 1;
    return 0;
  }

  function renderKeyboard() {
    var c = $('#kbc');
    if (!c) return;
    var u = state.u;
    var wide = state.layout === 104 ? 24 : 20;
    c.style.setProperty('--u', u + 'px');
    c.style.width = (wide * u) + 'px';
    c.style.height = (6 * u) + 'px';
    var html = '';
    HP.keyboard.keys.forEach(function (k) {
      if (state.layout === 87 && k.x >= 20) return;
      var cnt = keyCount(k.label);
      var lv = state.disp === 'real' ? 0 : levelOf(cnt);
      var L = LEVELS[lv];
      var label = KEY_LABEL[k.label] || k.display;
      var sel = state.sel === k.label ? ' sel' : '';
      html += '<button type="button" class="key' + sel + '" data-k="' + esc(k.label) + '" '
        + 'aria-pressed="' + (state.sel === k.label) + '" aria-label="' + esc(k.label + ' 键') + '" '
        + 'style="left:' + (k.x * u) + 'px;top:' + (k.y * u) + 'px;width:' + (k.w * u - 4) + 'px;height:' + (k.h * u - 4) + 'px;'
        + '--fill:' + L.c + ';--ink:' + L.ink + ';--bd:' + L.bd + '" data-lv="' + lv + '">' + esc(label) + '</button>';
    });
    c.innerHTML = html;
    keyEls = {};
    $$('.key', c).forEach(function (el) { keyEls[el.getAttribute('data-k')] = el; });
    $('#kbRangeMeta').textContent = keyRange().label + (state.viewReset ? ' · 视图已重置' : '');
    renderBand();
    renderTop10();
    renderChips();
    updateMasks();
  }

  function renderBand() {
    var box = $('#bandBars');
    if (!box) return;
    var vals = [];
    for (var m = NOW - 59; m <= NOW; m++) vals.push(HP.perMinute.keys[m] || 0);
    var max = Math.max.apply(null, vals) || 1;
    var bars = '';
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      var t = i / (vals.length - 1);
      var h = Math.max(2, Math.round(v / max * 40));
      var a = (0.2 + 0.78 * t).toFixed(2);
      var b = state.empty ? 0 : v;
      bars += '<div class="band-bar" data-m="' + (NOW - 59 + i) + '" data-v="' + b + '" '
        + 'style="height:' + (state.empty ? 2 : h) + 'px;background:rgba(226,234,245,' + (state.empty ? '.18' : a) + ')" '
        + 'title="' + clk(NOW - 59 + i) + '，' + nf(b) + ' 次"></div>';
    }
    box.innerHTML = bars;
    $('#bandA').textContent = clk(NOW - 59);
    $('#bandB').textContent = clk(NOW - 30);
    $('#bandC').textContent = clk(NOW);
    var peakIdx = vals.indexOf(max);
    $('#bandReadout').textContent = state.empty ? '无记录' : '峰值 ' + clk(NOW - 59 + peakIdx) + '，' + nf(max) + ' 次';
  }

  function renderTop10() {
    var box = $('#top10Table');
    if (!box) return;
    var rows = HP.keyList.slice(0, 10).map(function (x) {
      var cnt = keyCount(x.label);
      return { label: x.label, count: cnt };
    }).sort(function (a, b) { return b.count - a.count; });
    var max = rows[0] ? rows[0].count : 0;
    var total = keyTotalCur() || 1;
    var html = '<div class="t10-head"><span>#</span><span>键位</span><span></span><span>次数</span><span>占比</span></div>';
    rows.forEach(function (r, i) {
      var lv = levelByMax(r.count, max);
      var L = LEVELS[lv];
      var sel = state.sel === r.label ? ' is-sel' : '';
      html += '<div class="t10-row' + sel + '" data-k="' + esc(r.label) + '" role="button" tabindex="0">'
        + '<span class="t10-rank mono">' + (i + 1) + '</span>'
        + '<span class="t10-key">' + esc(KEY_LABEL[r.label] || r.label) + '</span>'
        + '<span class="t10-bar"><i style="width:' + (max ? Math.max(1, r.count / max * 100) : 0) + '%;background:' + L.c + '"></i></span>'
        + '<span class="t10-count mono">' + nf(r.count) + '</span>'
        + '<span class="t10-share mono">' + pf(r.count / total) + '</span>'
        + '</div>';
    });
    box.innerHTML = html;
  }

  function renderChips() {
    var box = $('#chips');
    if (!box) return;
    var html = '<span class="chips-label">高频键</span>';
    HP.top8.forEach(function (x) {
      var cnt = keyCount(x.label);
      html += '<button type="button" class="chip' + (state.sel === x.label ? ' is-sel' : '') + '" data-k="' + esc(x.label) + '" title="' + esc(KEY_LABEL[x.label] || x.label) + '，' + nf(cnt) + ' 次">'
        + esc(KEY_LABEL[x.label] || x.label) + '</button>';
    });
    box.innerHTML = html;
  }

  function renderLegend() {
    var box = $('#legend');
    if (!box) return;
    var labels = ['无', '很低', '低', '中', '高', '最高'];
    box.innerHTML = '<span class="legend-title">热力</span>' + LEVELS.map(function (L, i) {
      return '<span class="legend-item"><i style="--c:' + L.c + '"></i>' + labels[i] + '</span>';
    }).join('');
  }

  /* ---------------- mouse ---------------- */
  var zoneStats = null, zoneStatsMove = null;
  function zoneOf(x, y) {
    var nx = (x + 0.5) / 32, ny = (y + 0.5) / 18;
    if (Math.abs(nx - 0.52) < 0.13 && Math.abs(ny - 0.62) < 0.15) return '准星区';
    if (nx > 0.75 && ny < 0.26) return '小地图';
    if (nx < 0.17 && ny < 0.19) return '菜单';
    return '其他区';
  }
  function computeZones(src) {
    var t = { '准星区': 0, '小地图': 0, '菜单': 0, '其他区': 0 }, total = 0;
    src.forEach(function (g) { var z = zoneOf(g.x, g.y); t[z] += g.v; total += g.v; });
    return { t: t, total: total };
  }
  var moveCells = (function () {
    var map = {};
    HP.grid.forEach(function (g) { map[g.y * 32 + g.x] = g.v; });
    var total = sum(HP.moveHour);
    var out = [];
    for (var y = 0; y < 18; y++) {
      for (var x = 0; x < 32; x++) {
        var s = 0, w = 0;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= 32 || ny >= 18) continue;
            var wgt = Math.exp(-(dx * dx + dy * dy) / 3.4);
            s += (map[ny * 32 + nx] || 0) * wgt; w += wgt;
          }
        }
        var v = s / (w || 1);
        if (v > 0.5) out.push({ x: x, y: y, v: v });
      }
    }
    var sv = sum(out.map(function (o) { return o.v; })) || 1;
    out.forEach(function (o) { o.v = Math.round(o.v / sv * total); });
    return out;
  })();

  function mouseCells() { return state.layer === 'clicks' ? HP.grid : moveCells; }
  function zstats() {
    if (!zoneStats) { zoneStats = computeZones(HP.grid); zoneStatsMove = computeZones(moveCells); }
    return state.layer === 'clicks' ? zoneStats : zoneStatsMove;
  }

  function renderMouse() {
    var zs = zstats();
    renderScreen();
    renderMetrics();
    renderHotspots();
    renderMouseSvg();
    $('#metricRange').textContent = mouseRange().label;
    if (!state.cell) {
      var top = HP.grid.slice().sort(function (a, b) { return b.v - a.v; })[0];
      state.cell = top ? { x: top.x, y: top.y, v: top.v } : null;
    }
    var z = zs.t['准星区'];
    $('#gridFoot').textContent = state.empty
      ? '无记录'
      : '准星区 ' + nf(Math.round(z)) + ' 次，占 ' + pf(z / zs.total);
  }

  function renderScreen() {
    var box = $('#screenGrid');
    if (!box) return;
    var src = mouseCells();
    var factor = state.layer === 'clicks' ? mouseRange().factor : 1;
    var map = {};
    src.forEach(function (g) { map[g.y * 32 + g.x] = g.v; });
    var max = 0;
    src.forEach(function (g) { if (g.v > max) max = g.v; });
    var html = '';
    for (var y = 0; y < 18; y++) {
      for (var x = 0; x < 32; x++) {
        var raw = map[y * 32 + x] || 0;
        var v = state.empty ? 0 : Math.round(raw * factor);
        var lv = levelByMax(state.empty ? 0 : raw, max);
        var L = LEVELS[lv];
        var sel = state.cell && state.cell.x === x && state.cell.y === y ? ' sel' : '';
        html += '<div class="cell' + (v ? ' has' : '') + sel + '" data-x="' + x + '" data-y="' + y + '" data-v="' + v + '"'
          + (v ? ' style="--fill:' + L.c + ';--ink:' + L.ink + '"' : '') + '>' + (v || '') + '</div>';
      }
    }
    box.innerHTML = html;
  }

  function renderMetrics() {
    var box = $('#metrics');
    if (!box) return;
    var f = state.empty ? 0 : mouseRange().factor;
    var c = HP.clicks;
    var total = Math.round(c.total * f);
    var items = [
      ['总点击', total, ''],
      ['左键', Math.round(c.left * f), ''],
      ['右键', Math.round(c.right * f), ''],
      ['中键', Math.round(c.middle * f), ''],
      ['侧键', Math.round((c.side1 + c.side2) * f), ''],
      ['滚轮', '↑' + nf(Math.round(HP.wheel.up * f)) + ' / ↓' + nf(Math.round(HP.wheel.down * f)), ''],
      ['移动', '≈ ' + (HP.moveKm * f).toFixed(1), 'km'],
      ['峰值速度', HP.peakSpeed.toFixed(1), 'm/s']
    ];
    box.innerHTML = items.map(function (it) {
      return '<div class="metric"><span class="metric-l">' + it[0] + '</span>'
        + '<span class="metric-v mono">' + (typeof it[1] === 'number' ? nf(it[1]) : it[1]) + (it[2] ? '<small>' + it[2] + '</small>' : '') + '</span></div>';
    }).join('');
    $('#distTotal').textContent = typeof total === 'number' ? nf(total) : '';
    var parts = [
      ['左键', c.left, '#4c8dff'],
      ['右键', c.right, '#2f5f96'],
      ['中键', c.middle, '#6f8aa6'],
      ['侧键', c.side1 + c.side2, '#3a4654']
    ];
    $('#distStack').innerHTML = parts.map(function (p) {
      return '<i style="width:' + (p[1] / c.total * 100).toFixed(2) + '%;background:' + p[2] + '" title="' + p[0] + '"></i>';
    }).join('');
    $('#distLegend').innerHTML = parts.map(function (p) {
      return '<div class="dist-item"><i style="background:' + p[2] + '"></i>' + p[0]
        + '<b class="mono">' + nf(Math.round(p[1] * f)) + '</b></div>';
    }).join('');
    var rhythm = HP.clickHour;
    var rmax = Math.max.apply(null, rhythm) || 1;
    var rpi = rhythm.indexOf(rmax);
    $('#rhythmPeak').textContent = state.empty ? '无记录' : pad2(rpi) + ' 时 ' + nf(rmax) + ' 次';
    $('#rhythmBars').innerHTML = rhythm.map(function (v, i) {
      var h = state.empty ? 2 : Math.max(2, Math.round(v / rmax * 26));
      return '<i class="' + (i === rpi && !state.empty ? 'peak' : '') + '" style="height:' + h + 'px" title="' + pad2(i) + ' 时，' + nf(v) + ' 次"></i>';
    }).join('');
  }

  function renderHotspots() {
    var box = $('#hotspots');
    if (!box) return;
    var src = mouseCells();
    var f = state.empty ? 0 : (state.layer === 'clicks' ? mouseRange().factor : 1);
    var rows = src.slice().sort(function (a, b) { return b.v - a.v; }).slice(0, 6);
    var max = rows[0] ? rows[0].v : 1;
    box.innerHTML = rows.map(function (g, i) {
      var val = Math.round(g.v * f);
      var sel = state.cell && state.cell.x === g.x && state.cell.y === g.y ? ' is-sel' : '';
      return '<div class="hs-row' + sel + '" data-x="' + g.x + '" data-y="' + g.y + '">'
        + '<span class="hs-rank mono">' + (i + 1) + '</span>'
        + '<span class="hs-pos mono">(' + g.x + ', ' + g.y + ')</span>'
        + '<span class="hs-zone">' + zoneOf(g.x, g.y) + '</span>'
        + '<span class="hs-bar"><i style="width:' + Math.max(4, g.v / max * 100) + '%;background:' + LEVELS[levelByMax(g.v, max)].c + '"></i></span>'
        + '<span class="hs-count mono">' + nf(val) + '</span>'
        + '</div>';
    }).join('');
    $('#hotspotNote').textContent = state.empty
      ? '示例数据已清空。'
      : state.layer === 'clicks'
        ? '准星区格值最高。网格为主屏 32 × 18 归一化坐标；移动图层为按点击热力平滑估算的原型近似。'
        : '移动图层：按点击热力平滑估算的点数分布（原型近似），正式版由采样点单独统计。';
  }

  function renderMouseSvg() {
    zstats();
    var f = state.empty ? 0 : mouseRange().factor;
    var c = HP.clicks;
    $('#mLeftN').textContent = nf(Math.round(c.left * f));
    $('#mRightN').textContent = nf(Math.round(c.right * f));
    $('#mSideN').textContent = nf(Math.round((c.side1 + c.side2) * f));
    $('#mMid').textContent = nf(Math.round(c.middle * f));
    $('#mUp').textContent = '↑' + nf(Math.round(HP.wheel.up * f));
    $('#mDown').textContent = '↓' + nf(Math.round(HP.wheel.down * f));
    $('#mTotal').textContent = nf(Math.round(c.total * f));
  }

  /* ---------------- stats ---------------- */
  function niceStep(x) {
    if (!isFinite(x) || x <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var f = x / p;
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * p;
  }
  function lineSeries() {
    var r = state.range.stats;
    if (r === 'week') {
      var vals = [];
      HP.weekHeat.forEach(function (row) { row.forEach(function (v) { vals.push(Math.round(v * 60)); }); });
      var max = Math.max.apply(null, vals);
      var pi = vals.indexOf(max);
      var wd = Math.floor(pi / 24), hr = pi % 24;
      return {
        vals: vals, n: vals.length, unit: '次/时', xMode: 'index', xMax: vals.length,
        xTicks: HP.week.labels.map(function (l, i) { return { label: l, pos: (i * 24 + 12) / 168 }; }),
        peak: { idx: pi, val: max },
        peakText: '峰值 ' + nf(max) + ' 次/时，' + HP.week.labels[wd] + ' ' + pad2(hr) + ' 时',
        tip: function (i) { return HP.week.labels[Math.floor(i / 24)] + ' ' + pad2(i % 24) + ':00，' + nf(vals[i]) + ' 次/时'; },
        aria: '近 7 天每小时动作数折线图，峰值 ' + nf(max) + ' 次每小时'
      };
    }
    if (r === 'month') {
      var v30 = HP.days30.map(function (d) { return d.actions; });
      var m30 = Math.max.apply(null, v30);
      var p30 = v30.indexOf(m30);
      return {
        vals: v30, n: v30.length, unit: '次/天', xMode: 'index', xMax: v30.length,
        xTicks: HP.days30.map(function (d, i) { return i % 5 === 0 ? { label: d.date, pos: i / (v30.length - 1) } : null; }).filter(Boolean),
        peak: { idx: p30, val: m30 },
        peakText: '峰值 ' + nf(m30) + ' 次，' + HP.days30[p30].date,
        tip: function (i) { return HP.days30[i].date + '，' + nf(v30[i]) + ' 次'; },
        aria: '近 30 天每日动作数折线图，峰值 ' + nf(m30) + ' 次'
      };
    }
    var tv = [];
    for (var m = 0; m <= NOW; m++) tv.push((HP.perMinute.keys[m] || 0) + (HP.perMinute.clicks[m] || 0));
    return {
      vals: tv, n: tv.length, unit: '次/分', xMode: 'time', xMax: 1440,
      xTicks: [0, 3, 6, 9, 12, 15, 18, 21, 24].map(function (h) { return { label: h === 24 ? '24' : pad2(h), pos: h / 24 }; }),
      peak: { idx: HP.peak.minute, val: HP.peak.value },
      peakText: '峰值 ' + HP.peak.value + ' APM，' + HP.peak.label,
      tip: function (i) { return clk(i) + '，' + nf(tv[i]) + ' 次/分'; },
      aria: '今日每分钟动作数折线图，21:03 达到峰值 380 次每分钟'
    };
  }

  var lineGeom = null;
  function renderLine() {
    var box = $('#lineChart');
    if (!box) return;
    var W = Math.max(320, box.clientWidth), H = Math.max(120, box.clientHeight);
    var d = lineSeries();
    var m = { l: 46, r: 16, t: 16, b: 22 };
    var pw = Math.max(20, W - m.l - m.r), ph = Math.max(20, H - m.t - m.b);
    var maxVal = Math.max.apply(null, d.vals) || 1;
    var step = niceStep(maxVal / 4);
    var ymax = Math.max(step, Math.ceil(maxVal / step) * step);
    var n = d.n;
    function X(i) {
      return m.l + (d.xMode === 'time' ? (i / d.xMax) * pw : (n <= 1 ? 0 : (i / (n - 1)) * pw));
    }
    function Y(v) { return m.t + ph - (v / ymax) * ph; }
    var pts = [];
    for (var i = 0; i < n; i++) pts.push([X(i), Y(d.vals[i])]);
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[n - 1][0].toFixed(1) + ' ' + (m.t + ph) + ' L' + pts[0][0].toFixed(1) + ' ' + (m.t + ph) + ' Z';
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(d.aria) + '">';
    for (var v = 0; v <= ymax + 0.001; v += step) {
      var yy = Y(v);
      svg += '<line x1="' + m.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - m.r) + '" y2="' + yy.toFixed(1) + '" stroke="' + (v === 0 ? '#2a2e35' : '#1b1e23') + '" stroke-width="1"/>';
      svg += '<text x="' + (m.l - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + (v >= 1000 ? nf(Math.round(v)) : Math.round(v)) + '</text>';
    }
    d.xTicks.forEach(function (t) {
      var xx = m.l + t.pos * pw;
      svg += '<line x1="' + xx.toFixed(1) + '" y1="' + m.t + '" x2="' + xx.toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="#161a20"/>';
      svg += '<text x="' + xx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + esc(t.label) + '</text>';
    });
    svg += '<path d="' + area + '" fill="rgba(216,224,236,0.10)"/>';
    svg += '<path d="' + line + '" fill="none" stroke="#eef2f7" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>';
    if (d.xMode === 'time') {
      var xn = m.l + (NOW / 1440) * pw;
      svg += '<line x1="' + xn.toFixed(1) + '" y1="' + m.t + '" x2="' + xn.toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="#4c8dff" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>';
    }
    var px = pts[d.peak.idx][0], py = pts[d.peak.idx][1];
    svg += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3" fill="#4c8dff"/>';
    var anchor = px > W - 120 ? 'end' : 'start';
    var lx = anchor === 'end' ? px - 7 : px + 7;
    svg += '<text x="' + lx.toFixed(1) + '" y="' + Math.max(14, py - 8).toFixed(1) + '" text-anchor="' + anchor + '" font-size="12" fill="#e9edf3" font-family="JetBrains Mono, monospace">' + (d.peak.val >= 1000 ? nf(d.peak.val) : d.peak.val) + '</text>';
    svg += '<g id="crosshair" style="display:none"><line id="crossLine" x1="0" y1="' + m.t + '" x2="0" y2="' + (m.t + ph) + '" stroke="#4c8dff" stroke-width="1"/><circle id="crossDot" cx="0" cy="0" r="3.5" fill="none" stroke="#4c8dff" stroke-width="1.5"/></g>';
    svg += '</svg>';
    box.innerHTML = svg;
    lineGeom = { m: m, pw: pw, ph: ph, W: W, H: H, n: n, d: d, X: X, Y: Y };
    $('#lineReadout').textContent = d.peakText;
    $('#lineUnit').textContent = d.unit;
    $('#lineNote').textContent = statsSummary();
  }

  function statsSummary() {
    if (state.empty) return '该时段无记录。';
    var r = state.range.stats;
    if (r === 'week') {
      var best = { v: -1, wd: 0, h: 0 };
      HP.weekHeat.forEach(function (row, wd) { row.forEach(function (v, h) { if (v > best.v) best = { v: v, wd: wd, h: h }; }); });
      return HP.week.labels[best.wd] + ' ' + pad2(best.h) + ' 时最忙，平均每分钟 ' + Math.round(best.v) + ' 次；当日总量 ' + nf(HP.week.totals[best.wd]) + ' 次。';
    }
    if (r === 'month') {
      var mx = HP.days30[0], tot = 0;
      HP.days30.forEach(function (d) { tot += d.actions; if (d.actions > mx.actions) mx = d; });
      return mx.date + ' 最高，' + nf(mx.actions) + ' 次；近 30 天日均 ' + nf(Math.round(tot / HP.days30.length)) + ' 次。';
    }
    var hmax = 0, hv = -1;
    HP.apmHour.forEach(function (v, h) { if (v > hv) { hv = v; hmax = h; } });
    return hmax + ' 时最忙，平均每分钟 ' + Math.round(hv / 60) + ' 次；' + HP.peak.label + ' 单分钟峰值 ' + HP.peak.value + ' APM。';
  }

  /* histogram */
  function renderHist() {
    var box = $('#histChart');
    if (!box) return;
    var W = Math.max(280, box.clientWidth), H = Math.max(120, box.clientHeight);
    var tab = state.hist;
    var svg = '';
    if (tab === 'top20') {
      var tv = HP.histogram.top20;
      var maxT = tv[0].count || 1;
      var m = { l: 12, r: 12, t: 10, b: 8 };
      var rowH = (H - m.t - m.b) / 10;
      var half = (W - m.l - m.r - 18) / 2;
      svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="按键次数 Top 20 横向条形图，W 最高 1,204 次">';
      tv.forEach(function (t, i) {
        var col = i < 10 ? 0 : 1;
        var row = i % 10;
        var ox = m.l + col * (half + 18);
        var oy = m.t + row * rowH;
        var cx = m.l + col * (half + 18) + 44;
        var bw = half - 44 - 44;
        var v = state.empty ? 0 : t.count;
        var lv = levelByMax(v, maxT);
        var y = oy + rowH / 2;
        var nl = KEY_LABEL[t.label] || t.label;
        svg += '<text x="' + ox + '" y="' + (y + 4).toFixed(1) + '" font-size="12" fill="#a7b1bd" font-family="JetBrains Mono, monospace">' + esc(nl) + '</text>';
        svg += '<rect x="' + cx + '" y="' + (y - 3.5).toFixed(1) + '" width="' + bw + '" height="7" rx="2" fill="#1b1e23"/>';
        svg += '<rect x="' + cx + '" y="' + (y - 3.5).toFixed(1) + '" width="' + Math.max(1, v / maxT * bw).toFixed(1) + '" height="7" rx="2" fill="' + LEVELS[Math.max(1, lv)].c + '"/>';
        svg += '<text x="' + (ox + half - 2) + '" y="' + (y + 4).toFixed(1) + '" font-size="12" text-anchor="end" fill="#e9edf3" font-family="JetBrains Mono, monospace">' + nf(v) + '</text>';
      });
      svg += '</svg>';
      $('#histReadout').textContent = 'W 最高，' + nf(tv[0].count) + ' 次';
      box.innerHTML = svg;
      return;
    }
    var data;
    if (tab === 'hours') {
      var hv = HP.apmHour;
      data = { vals: hv, labels: hv.map(function (v, i) { return pad2(i); }), readout: '20 时，' + nf(hv[20]) + ' 次' };
    } else {
      var gv = HP.histogram.gaps;
      data = { vals: gv.map(function (g) { return g.value; }), labels: gv.map(function (g) { return g.label; }), readout: '50–100 ms 最多，' + nf(gv[1].value) + ' 次', log: true };
    }
    if (state.empty) { data.vals = data.vals.map(function () { return 0; }); data.readout = '该时段无记录'; }
    var mg = { l: 44, r: 12, t: data.log ? 22 : 12, b: 26 };
    var pw = Math.max(20, W - mg.l - mg.r), ph = Math.max(20, H - mg.t - mg.b);
    var max = Math.max.apply(null, data.vals) || 1;
    var step = 1, ymax = 1;
    if (data.log) {
      ymax = Math.log10(max + 1);
    } else {
      step = niceStep(max / 3);
      ymax = Math.max(step, Math.ceil(max / step) * step);
    }
    var n = data.vals.length;
    var slot = pw / n;
    var bw = Math.min(30, Math.max(6, slot * 0.6));
    svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(data.readout) + '">';
    if (!data.log) {
      for (var v = 0; v <= ymax + 0.001; v += step) {
        var yy = mg.t + ph - (v / ymax) * ph;
        svg += '<line x1="' + mg.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - mg.r) + '" y2="' + yy.toFixed(1) + '" stroke="' + (v === 0 ? '#2a2e35' : '#1b1e23') + '"/>';
        svg += '<text x="' + (mg.l - 6) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + (v >= 1000 ? nf(Math.round(v)) : Math.round(v)) + '</text>';
      }
    } else {
      svg += '<text x="' + (W - mg.r) + '" y="' + (mg.t - 10) + '" text-anchor="end" font-size="12" fill="#8a94a1">纵轴为对数刻度（1–' + nf(max) + '）</text>';
      [1, 10, 100, 1000, 10000].forEach(function (t) {
        if (Math.log10(t + 1) > ymax) return;
        var yy = mg.t + ph - (Math.log10(t) / ymax) * ph;
        svg += '<line x1="' + mg.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - mg.r) + '" y2="' + yy.toFixed(1) + '" stroke="#1b1e23"/>';
        svg += '<text x="' + (mg.l - 6) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + nf(t) + '</text>';
      });
    }
    for (var i = 0; i < n; i++) {
      var val = data.vals[i];
      var frac = state.empty ? 0 : (data.log ? Math.log10(val + 1) / ymax : val / ymax);
      var bh = state.empty ? 1 : Math.max(1, frac * ph);
      var bx = mg.l + i * slot + (slot - bw) / 2;
      var by = mg.t + ph - bh;
      var fill = data.log ? '#5f7f9e' : '#3d6a94';
      svg += '<rect class="hbar" data-i="' + i + '" x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + fill + '"/>';
      if (data.log && !state.empty) {
        svg += '<text x="' + (bx + bw / 2).toFixed(1) + '" y="' + (by - 5).toFixed(1) + '" text-anchor="middle" font-size="12" fill="#e9edf3" font-family="JetBrains Mono, monospace">' + nf(val) + '</text>';
      }
      svg += '<text x="' + (mg.l + i * slot + slot / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + esc(data.labels[i]) + '</text>';
    }
    if (state.empty) {
      svg += '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" font-size="12" fill="#8a94a1">该时段无记录</text>';
    }
    svg += '</svg>';
    box.innerHTML = svg;
    $('#histReadout').textContent = data.readout;
    $('#histReadout').title = data.readout;
  }

  /* heat */
  function heatLegend(x, y, minLabel, maxLabel) {
    var s = '<text x="' + x + '" y="' + (y + 9) + '" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + esc(minLabel) + '</text>';
    var lx = x + 26;
    for (var i = 0; i < 6; i++) {
      s += '<rect x="' + (lx + i * 13) + '" y="' + y + '" width="10" height="10" rx="1" fill="' + LEVELS[i].c + '"/>';
    }
    s += '<text x="' + (lx + 6 * 13 + 6) + '" y="' + (y + 9) + '" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + esc(maxLabel) + '</text>';
    return s;
  }
  function renderHeat() {
    var box = $('#heatChart');
    if (!box) return;
    var W = Math.max(280, box.clientWidth), H = Math.max(120, box.clientHeight);
    var svg = '';
    if (state.heat === 'week') {
      var left = 36, top = 6, bottom = 40;
      var cw = (W - left - 8) / 24, ch = (H - top - bottom) / 7;
      svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="7 乘 24 小时平均动作热力图，周三 20 时最深">';
      for (var wd = 0; wd < 7; wd++) {
        var yy = top + wd * ch;
        svg += '<text x="' + (left - 8) + '" y="' + (yy + ch / 2 + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="' + (wd === 2 ? '#9cc0ff' : '#8a94a1') + '" font-family="Noto Sans SC, sans-serif">' + HP.week.labels[wd] + '</text>';
        for (var h = 0; h < 24; h++) {
          var v = state.empty ? 0 : HP.weekHeat[wd][h];
          var lv = levelByMax(v, HP.weekHeatMax);
          var x = left + h * cw;
          svg += '<rect class="hcell" data-wd="' + wd + '" data-h="' + h + '" x="' + (x + 0.5).toFixed(1) + '" y="' + (yy + 0.5).toFixed(1) + '" width="' + Math.max(1, cw - 1).toFixed(1) + '" height="' + Math.max(1, ch - 1).toFixed(1) + '" rx="1" fill="' + LEVELS[lv].c + '"' + (wd === 2 ? ' stroke="rgba(76,141,255,.45)" stroke-width="0.5"' : '') + '/>';
        }
      }
      [0, 3, 6, 9, 12, 15, 18, 21].forEach(function (h) {
        svg += '<text x="' + (left + h * cw).toFixed(1) + '" y="' + (H - 26) + '" font-size="12" fill="#8a94a1" font-family="JetBrains Mono, monospace">' + pad2(h) + '</text>';
      });
      svg += heatLegend(left, H - 16, '0', HP.weekHeatMax.toFixed(1) + ' 次/分');
      svg += '</svg>';
      $('#heatReadout').textContent = state.empty ? '无记录' : '周三 20 时，' + HP.weekHeat[2][20].toFixed(1) + ' 次/分';
    } else {
      var cl = 22;
      var cols = 54;
      var cellW = (W - cl - 8) / cols;
      var cellH = cellW;
      var gridH = 7 * cellH;
      var ct = 22 + Math.max(0, (H - 22 - 58 - gridH) / 2);
      var firstWd = ((2 - 370) % 7 + 7) % 7;
      svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="日历热力，今日描边高亮">';
      var months = {};
      HP.calendar.forEach(function (d, i) {
        var wd = (firstWd + i) % 7;
        var col = Math.floor((firstWd + i) / 7);
        if (col >= cols) return;
        var dt = new Date(2025, 9, 30);
        dt.setDate(dt.getDate() + i);
        if (dt.getDate() === 1) {
          var key = dt.getMonth() + 1;
          if (months[key] === undefined) months[key] = col;
        }
        var x = cl + col * cellW, y = ct + wd * cellH;
        var lv = levelByMax(state.empty ? 0 : d.v, HP.calendarMax);
        var isToday = i === HP.calendar.length - 1;
        svg += '<rect class="ccell" data-i="' + i + '" x="' + (x + 0.5).toFixed(1) + '" y="' + (y + 0.5).toFixed(1) + '" width="' + Math.max(1, cellW - 1).toFixed(1) + '" height="' + Math.max(1, cellH - 1).toFixed(1) + '" rx="1" fill="' + (state.empty ? LEVELS[0].c : LEVELS[lv].c) + '"' + (isToday ? ' stroke="#4c8dff" stroke-width="1.2"' : '') + '/>';
      });
      var lastX = -100;
      Object.keys(months).sort(function (a, b) { return months[a] - months[b]; }).forEach(function (mo) {
        var x = cl + months[mo] * cellW;
        if (x - lastX < 26) return;
        lastX = x;
        svg += '<text x="' + x.toFixed(1) + '" y="' + (ct - 8) + '" font-size="12" fill="#8a94a1">' + mo + ' 月</text>';
      });
      var mx30 = HP.days30.reduce(function (a, b) { return b.actions > a.actions ? b : a; });
      svg += '<text x="' + cl + '" y="' + (ct + gridH + 26) + '" font-size="12" fill="#8a94a1">近 ' + HP.calendar.length + ' 天，最高 ' + mx30.date + ' ' + nf(mx30.actions) + ' 次；蓝框为今日 11/04。</text>';
      svg += heatLegend(cl, H - 18, '少', nf(HP.calendarMax) + ' 次/天');
      svg += '</svg>';
      $('#heatReadout').textContent = state.empty ? '无记录' : '11/04，' + nf(HP.calendar[HP.calendar.length - 1].v) + ' 次';
    }
    box.innerHTML = svg;
  }

  /* table */
  function tableRows() {
    var r = state.range.stats;
    var rows = [];
    if (r === 'week') {
      var totalAct = 0;
      HP.weekHeat.forEach(function (row) { row.forEach(function (v) { totalAct += Math.round(v * 60); }); });
      var moveCm = HP.moveKm * 100000 * (sum(HP.week.totals) / HP.keyTotal);
      HP.weekHeat.forEach(function (row, wd) {
        var keyRatio = HP.week.keys[wd] / HP.week.totals[wd];
        row.forEach(function (v, h) {
          var a = Math.round(v * 60);
          var k = Math.round(a * keyRatio);
          rows.push({ t: HP.week.labels[wd] + ' ' + pad2(h) + ':00', a: a, k: k, c: a - k, mv: Math.round(moveCm * a / (totalAct || 1)) });
        });
      });
      rows.reverse();
      return rows;
    }
    if (r === 'month') {
      var totalClk = sum(HP.days30.map(function (d) { return d.clicks; }));
      var mCm = HP.moveKm * 100000 * (sum(HP.days30.map(function (d) { return d.actions; })) / HP.keyTotal);
      HP.days30.forEach(function (d) {
        rows.push({ t: d.date, a: d.actions, k: d.keys, c: d.clicks, mv: Math.round(mCm * d.clicks / (totalClk || 1)) });
      });
      rows.reverse();
      return rows;
    }
    for (var m = NOW; m >= 0; m--) {
      var k = HP.perMinute.keys[m] || 0, c = HP.perMinute.clicks[m] || 0;
      rows.push({ t: clk(m), a: k + c, k: k, c: c, mv: Math.round(HP.moveKm * 100000 * c / HP.clickTotal) });
    }
    return rows;
  }
  var PAGE_SIZE = 50;
  function renderTable() {
    var rows = tableRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > pages - 1) state.page = 0;
    var start = state.page * PAGE_SIZE;
    var chunk = rows.slice(start, start + PAGE_SIZE).slice(0, 8);
    var box = $('#tableRows');
    box.innerHTML = chunk.map(function (r) {
      return '<div class="t-row"><span class="t-time">' + esc(r.t) + '</span><span>' + nf(r.a) + '</span><span>' + nf(r.k) + '</span><span>' + nf(r.c) + '</span><span>' + nf(r.mv) + '</span></div>';
    }).join('');
    $('#tableCount').textContent = state.empty ? '无记录' : '共 ' + nf(rows.length) + ' 行，每页 50 行';
    $('#tableGran').textContent = state.range.stats === 'week' ? '每桶 1 小时' : state.range.stats === 'month' ? '每桶 1 天' : '每桶 60 秒';
    $('#pager').innerHTML = '<button class="pg-btn" data-pg="-1" type="button"' + (state.page === 0 ? ' disabled' : '') + '>上一页</button>'
      + '<span class="pg-cur mono">第 ' + (state.page + 1) + ' / ' + pages + ' 页</span>'
      + '<button class="pg-btn" data-pg="1" type="button"' + (state.page >= pages - 1 ? ' disabled' : '') + '>下一页</button>'
      + '<span class="pg-spacer"></span><span>' + (state.empty ? '—' : '导出范围为当前筛选的全部行') + '</span>';
  }

  function renderStats() {
    renderLine();
    renderHist();
    renderHeat();
    renderTable();
  }

  /* ---------------- settings ---------------- */
  function renderSettings() {
    buildSegsOnce();
    $('#swCollect').setAttribute('aria-checked', String(!state.paused));
    $('#swAuto').setAttribute('aria-checked', String(state.autoStart));
    $('#granSeg').innerHTML = [10, 30, 60].map(function (g) {
      return '<button type="button" data-g="' + g + '" aria-pressed="' + (state.granularity === g) + '">' + g + ' 秒</button>';
    }).join('');
    $('#keepSeg').innerHTML = [7, 30, 90].map(function (k) {
      return '<button type="button" data-k="' + k + '" aria-pressed="' + (state.retention === k) + '">' + k + ' 天</button>';
    }).join('');
    $('#emptyBanner').hidden = !state.empty;
  }

  /* ---------------- inspector ---------------- */
  function kvRow(label, value, hint) {
    return '<div class="row"><span>' + label + '</span><b class="mono">' + value + (hint ? '<em>' + hint + '</em>' : '') + '</b></div>';
  }
  function keyboardInspector() {
    if (state.empty || state.viewReset) {
      return '<div class="insp-empty"><b>没有可展示的键位证据。</b><br>当前视图已被清空，历史数据未受影响。刷新页面或点「恢复演示数据」可回到示例。</div>';
    }
    var label = state.hover || state.sel;
    if (!label) {
      return '<div class="insp-empty"><b>选一个键，查看它的全部证据。</b><br>悬停预览，点击固定，ESC 关闭。键盘上显示的是今日累计次数映射的 6 级热力。</div>'
        + '<div class="insp-sec"><div class="sec-head">今日总览</div>'
        + '<div class="rows">' + kvRow('按键次数', nf(HP.keyTotal)) + kvRow('点击次数', nf(HP.clickTotal)) + kvRow('动作合计', nf(HP.actionTotal)) + kvRow('键位数量', '104') + '</div></div>';
    }
    var cnt = keyCount(label);
    var total = keyTotalCur();
    var ratio = total ? cnt / total : 0;
    var lv = levelOf(cnt);
    var L = LEVELS[lv];
    var pos = keyPos(label);
    var times = keyTimes(label);
    var isA = label === 'A';
    var avg = isA ? HP.holds.keyAvg : HP.holds.avg;
    var maxHold = isA ? HP.holds.keyMaxHold : HP.holds.max;
    var rank = rankOf(label);
    var name = KEY_LABEL[label] || label;
    var rt = '今日';
    if (state.range.keyboard === 'session') rt = '本次（最近 30 分钟）';
    if (state.range.keyboard === 'week') rt = '7 天';
    return '<div class="hero"><span class="hero-key mono">' + esc(name) + '</span>'
      + '<div class="hero-meta"><span class="hero-name">' + esc(label) + ' 键</span>'
      + '<span class="hero-rank">' + (state.range.keyboard === 'today' ? '按次数第 ' + rank + ' 位' : rt + ' 读数') + '</span></div></div>'
      + '<div class="hero-meter"><i style="width:' + (ratio * 100).toFixed(1) + '%"></i></div>'
      + '<div class="hero-note"><span class="swatch-line" style="background:' + L.c + '"></span>热力 L' + lv + '，占全部按键 ' + pf(ratio) + '</div>'
      + '<div class="rows">'
      + kvRow('次数', nf(cnt))
      + kvRow('占比', pf(ratio))
      + kvRow('平均按住', nf(avg) + ' ms', isA ? '' : '全局')
      + kvRow('最长按住', nf(maxHold) + ' ms', isA ? '' : 'A 键')
      + kvRow('首次出现', times[0])
      + kvRow('最近出现', times[1])
      + kvRow('物理位置', '第 ' + pos.row + ' 行 / 第 ' + pos.col + ' 列')
      + '</div>'
      + '<p class="insp-p">长按只计 1 次，松开再按才 +1。修饰键左右分开计数，和输入内容无关。</p>'
      + '<div class="insp-rule">范围只改读数，键间相对热度沿用今日分布。ESC 关闭详情。</div>';
  }

  function mouseInspector() {
    var zs = zstats();
    var f = state.empty ? 0 : (state.layer === 'clicks' ? mouseRange().factor : 1);
    var c = HP.clicks;
    var src = mouseCells();
    var layerTotal = 0;
    src.forEach(function (g) { layerTotal += g.v; });
    var cell = state.cell || { x: 16, y: 10, v: HP.gridMax };
    var cellRaw = 0;
    src.forEach(function (g) { if (g.x === cell.x && g.y === cell.y) cellRaw = g.v; });
    if (!cellRaw && state.layer === 'move') {
      src.forEach(function (g) { if (g.x === 16 && g.y === 10) cellRaw = g.v; });
    }
    var cellVal = Math.round(cellRaw * f);
    var zone = zoneOf(cell.x, cell.y);
    var parts = [['左键', c.left, '#4c8dff'], ['右键', c.right, '#2f5f96'], ['中键', c.middle, '#6f8aa6'], ['侧键', c.side1 + c.side2, '#3a4654']];
    return '<div class="insp-sec"><div class="sec-head">点击构成</div>'
      + '<div class="stackbar">' + parts.map(function (p) { return '<i style="width:' + (p[1] / c.total * 100).toFixed(2) + '%;background:' + p[2] + '"></i>'; }).join('') + '</div>'
      + '<div class="rows">' + parts.map(function (p) { return '<div class="row"><span><span class="swatch-line" style="background:' + p[2] + '"></span>' + p[0] + '</span><b class="mono">' + nf(Math.round(p[1] * f)) + '<em>' + pf(p[1] / c.total) + '</em></b></div>'; }).join('') + '</div></div>'
      + '<div class="insp-sec"><div class="sec-head">选中格（' + (state.layer === 'clicks' ? '点击' : '移动') + '图层）</div>'
      + '<div class="zone-hero mono">(' + cell.x + ', ' + cell.y + ') <span class="zone-num">' + nf(cellVal) + '</span></div>'
      + '<div class="rows">'
      + kvRow('区域', zone)
      + kvRow(state.layer === 'clicks' ? '占全部点击' : '占移动点数', pf(layerTotal ? cellRaw / layerTotal : 0))
      + kvRow('滚轮', '↑' + nf(Math.round(HP.wheel.up * f)) + ' / ↓' + nf(Math.round(HP.wheel.down * f)))
      + kvRow('移动距离', '≈ ' + (HP.moveKm * f).toFixed(1) + ' km')
      + '</div></div>'
      + '<p class="insp-p">' + (state.empty ? '示例数据已清空。' : (state.layer === 'clicks' ? '范围换算：本次取最近 30 分钟，7 天按点击总量等比折算；网格只覆盖主屏。' : '移动图层为原型近似：按点击热力平滑估算，正式版由采样点单独统计。')) + '</p>';
  }

  function statsInspector() {
    var r = state.range.stats;
    var lines = [['日总动作', nf(HP.actionTotal)], ['今日按键', nf(HP.keyTotal)], ['今日点击', nf(HP.clickTotal)], ['峰值', HP.peak.value + ' APM'], ['峰值时刻', HP.peak.label]];
    var view = r === 'today' ? '今日 · 分钟桶 1,304 行' : r === 'week' ? '7 天 · 小时桶 168 行' : '30 天 · 天桶 30 行';
    return '<div class="insp-sec"><div class="sec-head">图表摘要</div><p class="insp-p" style="padding:0">' + esc(statsSummary()) + '</p></div>'
      + '<div class="insp-sec"><div class="sec-head">关键读数</div><div class="rows">' + lines.map(function (l) { return kvRow(l[0], l[1]); }).join('') + '</div></div>'
      + '<div class="insp-sec"><div class="sec-head">当前视图</div><div class="rows">' + kvRow('范围', view) + kvRow('粒度', r === 'today' ? '1 分钟' : r === 'week' ? '1 小时' : '1 天') + '</div>'
      + '<div style="padding-top:10px"><button class="tbtn" id="inspExport" type="button">导出当前范围 CSV</button></div></div>'
      + '<div class="insp-rule">对数轴的分布图在左下角标注；峰值只标一个，避免噪音。</div>';
  }

  function settingsInspector() {
    var buckets = state.range.keyboard === 'session' ? 30 : state.range.keyboard === 'week' ? 128 : 1304;
    return '<div class="insp-sec"><div class="sec-head">采集内核</div><div class="rows">'
      + kvRow('HandPulse Core', state.paused ? '已暂停' : '运行中')
      + kvRow('采样间隔', '100 ms')
      + kvRow('写入粒度', state.granularity + ' 秒')
      + kvRow('开机自启', state.autoStart ? '开' : '关')
      + '</div></div>'
      + '<div class="insp-sec"><div class="sec-head">存储</div><div class="rows">'
      + kvRow('数据库', 'data.db')
      + kvRow('保留', state.retention + ' 天')
      + kvRow('当前范围桶数', nf(buckets))
      + kvRow('今日动作', nf(HP.actionTotal))
      + '</div></div>'
      + '<p class="insp-p">关闭总开关会立即停止写入；清空需要输入 DELETE，删除后不可恢复。</p>';
  }

  function renderInspector() {
    var body = $('#inspBody');
    if (!body) return;
    if (state.route === 'keyboard') body.innerHTML = keyboardInspector();
    else if (state.route === 'mouse') body.innerHTML = mouseInspector();
    else if (state.route === 'stats') body.innerHTML = statsInspector();
    else body.innerHTML = settingsInspector();
    var ex = $('#inspExport');
    if (ex) ex.addEventListener('click', function () { toast('CSV 导出为原型占位，正式版导出当前范围全部行。'); });
    $('#inspSub').textContent = state.route === 'keyboard' && state.sel && !state.empty && !state.viewReset ? '键位 · ' + state.sel : SUBS[state.route];
    $('#inspX').hidden = !(state.route === 'keyboard' && state.sel && !state.empty && !state.viewReset);
  }

  /* ---------------- live ---------------- */
  function weightedKey() {
    var list = HP.keyList.slice(0, 40);
    var total = 0;
    list.forEach(function (x) { total += x.count; });
    var r = rnd() * total;
    for (var i = 0; i < list.length; i++) { r -= list[i].count; if (r <= 0) return list[i].label; }
    return 'W';
  }
  function flash(label) {
    var el = keyEls[label];
    if (!el || !el.classList) return;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 120);
  }
  var mouseFlashes = ['mLeft', 'mRight', 'mWheel', 'mSide1', 'mSide2'];
  var lastMouseFlash = 0;
  function flashMouse() {
    if (Date.now() - lastMouseFlash < 300) return;
    lastMouseFlash = Date.now();
    var id = mouseFlashes[Math.floor(rnd() * mouseFlashes.length)];
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('lit');
    setTimeout(function () { el.classList.remove('lit'); }, 120);
  }
  function tick() {
    if (state.paused) { if (state.route === 'keyboard') updateMasks(); return; }
    var rate = ((HP.perMinute.keys[NOW] || 0) + (HP.perMinute.clicks[NOW] || 0));
    tapeCells.shift();
    tapeCells.push({ ev: rnd() < rate / CELLS ? 0.45 + rnd() * 0.55 : 0, idle: 0.05 + rnd() * 0.06 });
    drawTape();
    if (state.empty || reduce) return;
    if (state.route === 'keyboard' && state.disp !== 'heat') {
      if (rnd() < 0.4) flash(weightedKey());
    } else if (state.route === 'mouse') {
      if (rnd() < 0.5) flashMouse();
    }
  }

  /* ---------------- modal / toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function openModal(kind) {
    var body = $('#modalBody');
    if (kind === 'clear') {
      $('#modalTitle').textContent = '清空全部数据';
      body.innerHTML = '<p class="modal-p">将删除本机数据库里的全部采集记录。删除后不可恢复。请输入 DELETE 以确认。</p>'
        + '<input class="modal-input" id="modalInput" type="text" autocomplete="off" spellcheck="false" placeholder="DELETE" aria-label="输入 DELETE 确认">'
        + '<div class="modal-actions"><button class="btn" data-close type="button">取消</button><button class="btn danger" id="modalOk" type="button" disabled>清空全部数据</button></div>';
      var input = $('#modalInput');
      input.addEventListener('input', function () {
        $('#modalOk').disabled = input.value.trim().toUpperCase() !== 'DELETE';
      });
      $('#modalOk').addEventListener('click', function () {
        state.empty = true; state.page = 0; state.cell = null;
        closeModal();
        renderRangeSeg();
        if (state.route === 'settings') renderSettings(); else applyRoute(state.route);
        renderInspector();
        updateMasks();
        toast('全部数据已清空（原型演示：刷新页面可恢复）。');
      });
      setTimeout(function () { input.focus(); }, 30);
    } else if (kind === 'reset') {
      $('#modalTitle').textContent = '重置当前视图';
      body.innerHTML = '<p class="modal-p">只清空页面显示，历史数据不受影响。下次采集仍会写入数据库。</p>'
        + '<div class="modal-actions"><button class="btn" data-close type="button">取消</button><button class="btn primary" id="modalOk" type="button">重置视图</button></div>';
      $('#modalOk').addEventListener('click', function () {
        state.viewReset = true;
        closeModal();
        renderKeyboard(); renderInspector();
        toast('视图已重置，历史数据未改动。再次点击可恢复视图。');
      });
    }
    $('#modal').hidden = false;
  }
  function closeModal() { $('#modal').hidden = true; $('#modalInput') && ($('#modalInput').value = ''); }

  /* ---------------- restore ---------------- */
  function restore() {
    state.empty = false; state.viewReset = false; state.page = 0;
    if (state.route === 'keyboard') { renderKeyboard(); }
    if (state.route === 'mouse') { renderMouse(); }
    if (state.route === 'stats') { renderStats(); }
    if (state.route === 'settings') { renderSettings(); }
    renderInspector(); updateMasks();
    toast('已恢复示例数据。');
  }

  /* ---------------- build static ---------------- */
  var built = false;
  function buildSegsOnce() {
    if (built) return;
    built = true;
    $('#dispSeg').innerHTML = [['all', '全部'], ['heat', '仅热力'], ['real', '仅实时']].map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (state.disp === o[0]) + '">' + o[1] + '</button>';
    }).join('');
    $('#layoutSeg').innerHTML = [[104, '104'], [87, '87']].map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (state.layout === o[0]) + '">' + o[1] + '</button>';
    }).join('');
    $('#layerSeg').innerHTML = [['clicks', '点击'], ['move', '移动']].map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (state.layer === o[0]) + '">' + o[1] + '</button>';
    }).join('');
    $('#histSeg').innerHTML = [['top20', 'Top 20'], ['hours', '时段'], ['gaps', '间隔']].map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (state.hist === o[0]) + '">' + o[1] + '</button>';
    }).join('');
    $('#heatSeg').innerHTML = [['week', '7×24'], ['cal', '日历']].map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (state.heat === o[0]) + '">' + o[1] + '</button>';
    }).join('');
    renderLegend();
  }

  function setSegPressed(sel, value) {
    $$('button', $(sel)).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(value))); });
  }

  /* ---------------- events ---------------- */
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      var segBtn = t.closest && t.closest('.seg button');
      if (segBtn) {
        var box = segBtn.parentElement;
        var v = segBtn.getAttribute('data-v') || segBtn.getAttribute('data-g') || segBtn.getAttribute('data-k');
        if (box.id === 'dispSeg') { state.disp = v; setSegPressed('#dispSeg', v); renderKeyboard(); }
        else if (box.id === 'layoutSeg') { state.layout = parseInt(v, 10); setSegPressed('#layoutSeg', v); layoutKeyboard(); renderKeyboard(); }
        else if (box.id === 'layerSeg') { state.layer = v; setSegPressed('#layerSeg', v); state.cell = null; renderScreen(); renderHotspots(); renderInspector(); }
        else if (box.id === 'histSeg') { state.hist = v; setSegPressed('#histSeg', v); renderHist(); }
        else if (box.id === 'heatSeg') { state.heat = v; setSegPressed('#heatSeg', v); renderHeat(); }
        else if (box.id === 'rangeSeg') {
          var route = state.route;
          if (route === 'settings') return;
          state.range[route] = v; state.page = 0; state.cell = null;
          renderRangeSeg();
          if (route === 'keyboard') { renderKeyboard(); }
          if (route === 'mouse') { renderMouse(); }
          if (route === 'stats') { renderStats(); }
          renderInspector(); updateMasks();
        }
        return;
      }
      var key = t.closest && t.closest('.key');
      if (key) { state.sel = key.getAttribute('data-k'); state.hover = null; renderKeyboard(); renderInspector(); return; }
      if (t.closest && t.closest('#kbstage') && !t.closest('.key')) { state.sel = null; renderKeyboard(); renderInspector(); return; }
      var t10 = t.closest && t.closest('.t10-row');
      if (t10) { state.sel = t10.getAttribute('data-k'); state.hover = null; renderKeyboard(); renderInspector(); pulse(t10.getAttribute('data-k')); return; }
      var chip = t.closest && t.closest('.chip');
      if (chip) { state.sel = chip.getAttribute('data-k'); state.hover = null; renderKeyboard(); renderInspector(); return; }
      var hs = t.closest && t.closest('.hs-row');
      if (hs) {
        state.cell = { x: parseInt(hs.getAttribute('data-x'), 10), y: parseInt(hs.getAttribute('data-y'), 10), v: 0 };
        renderScreen(); renderHotspots(); renderInspector(); return;
      }
      var cell = t.closest && t.closest('.cell');
      if (cell) {
        var vv = parseInt(cell.getAttribute('data-v'), 10) || 0;
        state.cell = { x: parseInt(cell.getAttribute('data-x'), 10), y: parseInt(cell.getAttribute('data-y'), 10), v: vv };
        renderInspector(); return;
      }
      var pg = t.closest && t.closest('.pg-btn');
      if (pg && !pg.disabled) {
        var dir = parseInt(pg.getAttribute('data-pg'), 10);
        var rows = tableRows();
        var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        state.page = Math.max(0, Math.min(pages - 1, state.page + dir));
        renderTable(); return;
      }
      if (t.closest && t.closest('[data-close]')) { closeModal(); return; }
      if (t.closest && t.closest('[data-restore]')) { restore(); return; }
      if (t.closest && t.closest('#modal')) {
        if (t.id === 'modal' || t.id === 'modalX') closeModal();
      }
    });

    $('#statusBtn').addEventListener('click', function () { setPaused(!state.paused); });
    $('#pauseBtn').addEventListener('click', function () { setPaused(!state.paused); });
    $('#kbMaskBtn').addEventListener('click', function () {
      var a = $('#kbMaskBtn').getAttribute('data-action');
      if (a === 'resume') setPaused(false); else restore();
    });

    $('#exportKb').addEventListener('click', function () { toast('CSV 导出为原型占位，正式版导出当前范围全部行。'); });
    $('#exportTable').addEventListener('click', function () { toast('CSV 导出为原型占位，正式版导出当前筛选范围全部行。'); });
    $('#openDir').addEventListener('click', function () { toast('打开目录为原型占位。'); });
    $('#expCsv').addEventListener('click', function () { toast('导出 CSV 为原型占位。'); });
    $('#expJson').addEventListener('click', function () { toast('导出 JSON 为原型占位。'); });

    $('#resetView').addEventListener('click', function () {
      if (state.viewReset) {
        state.viewReset = false; renderKeyboard(); renderInspector();
        toast('已恢复视图显示。');
      } else openModal('reset');
    });
    $('#clearAll').addEventListener('click', function () { openModal('clear'); });

    $('#swCollect').addEventListener('click', function () { setPaused(!state.paused); });
    $('#swAuto').addEventListener('click', function () {
      state.autoStart = !state.autoStart;
      $('#swAuto').setAttribute('aria-checked', String(state.autoStart));
      renderInspector();
      toast(state.autoStart ? '开机自启已开启。' : '开机自启已关闭。');
    });

    $('#modalX').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#modal').hidden) { closeModal(); return; }
        if (state.route === 'keyboard' && state.sel) { state.sel = null; state.hover = null; renderKeyboard(); renderInspector(); }
      }
    });

    // key hover preview
    document.addEventListener('mouseover', function (e) {
      var k = e.target.closest && e.target.closest('.key');
      if (k && state.route === 'keyboard') {
        var label = k.getAttribute('data-k');
        if (state.hover !== label) { state.hover = label; renderInspector(); }
      }
    });
    document.addEventListener('mouseout', function (e) {
      var k = e.target.closest && e.target.closest('.key');
      if (k && state.route === 'keyboard') { state.hover = null; renderInspector(); }
    });

    // band hover readout
    $('#bandBars').addEventListener('mouseover', function (e) {
      var b = e.target.closest && e.target.closest('.band-bar');
      if (!b) return;
      var v = parseInt(b.getAttribute('data-v'), 10) || 0;
      $('#bandReadout').textContent = clk(parseInt(b.getAttribute('data-m'), 10)) + '，' + nf(v) + ' 次';
    });

    // grid hover
    $('#screenGrid').addEventListener('mouseover', function (e) {
      var c = e.target.closest && e.target.closest('.cell');
      if (!c) return;
      var v = parseInt(c.getAttribute('data-v'), 10) || 0;
      state.cell = { x: parseInt(c.getAttribute('data-x'), 10), y: parseInt(c.getAttribute('data-y'), 10), v: v };
      $$('.cell.sel', $('#screenGrid')).forEach(function (x) { x.classList.remove('sel'); });
      c.classList.add('sel');
      renderInspector();
    });

    // charts hover
    $('#lineChart').addEventListener('mousemove', function (e) {
      if (!lineGeom) return;
      var g = lineGeom, rect = $('#lineChart').getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var idx = g.d.xMode === 'time' ? Math.round((mx - g.m.l) / g.pw * g.d.xMax) : Math.round((mx - g.m.l) / g.pw * (g.n - 1));
      idx = Math.max(0, Math.min(g.n - 1, idx));
      var ch = document.getElementById('crosshair');
      if (!ch) return;
      var x = g.X(idx), y = g.Y(g.d.vals[idx]);
      var line = document.getElementById('crossLine'), dot = document.getElementById('crossDot');
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      dot.setAttribute('cx', x); dot.setAttribute('cy', y);
      ch.style.display = '';
      $('#lineReadout').textContent = g.d.tip(idx);
    });
    $('#lineChart').addEventListener('mouseleave', function () {
      var ch = document.getElementById('crosshair');
      if (ch) ch.style.display = 'none';
      if (lineGeom) $('#lineReadout').textContent = lineGeom.d.peakText;
    });
    $('#histChart').addEventListener('mousemove', function (e) {
      var r = e.target.closest && e.target.closest('.hbar');
      if (!r) return;
      var i = parseInt(r.getAttribute('data-i'), 10);
      var hg = currentHist;
      if (hg) $('#histReadout').textContent = hg(i);
    });
    $('#heatChart').addEventListener('mousemove', function (e) {
      var c = e.target.closest && e.target.closest('.hcell');
      if (c) {
        var wd = parseInt(c.getAttribute('data-wd'), 10), h = parseInt(c.getAttribute('data-h'), 10);
        $('#heatReadout').textContent = HP.week.labels[wd] + ' ' + pad2(h) + ' 时，' + HP.weekHeat[wd][h].toFixed(1) + ' 次/分';
        return;
      }
      var cc = e.target.closest && e.target.closest('.ccell');
      if (cc) {
        var i = parseInt(cc.getAttribute('data-i'), 10), d = HP.calendar[i];
        $('#heatReadout').textContent = d.iso + '，' + nf(d.v) + ' 次';
      }
    });

    window.addEventListener('hashchange', function () {
      var r = parseRoute();
      if (r !== state.route) applyRoute(r);
    });
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        drawTape();
        if (state.route === 'keyboard') { layoutKeyboard(); renderKeyboard(); }
        if (state.route === 'mouse') renderMouse();
        if (state.route === 'stats') renderStats();
      }, 120);
    });
  }

  var currentHist = null;
  // wrap hist readout tips
  var _renderHist = renderHist;
  renderHist = function () {
    _renderHist();
    if (state.hist === 'hours') currentHist = function (i) { return pad2(i) + ' 时，' + nf(HP.apmHour[i]) + ' 次'; };
    else if (state.hist === 'gaps') currentHist = function (i) { var g = HP.histogram.gaps[i]; return g.label + ' ms，' + nf(g.value) + ' 次'; };
    else currentHist = function (i) { var t = HP.histogram.top20[i]; return (KEY_LABEL[t.label] || t.label) + '，' + nf(t.count) + ' 次'; };
  };

  function pulse(label) {
    var el = keyEls[label];
    if (!el) return;
    el.classList.add('pulse');
    setTimeout(function () { el.classList.remove('pulse'); }, 760);
  }

  /* ---------------- init ---------------- */
  function init() {
    buildSegsOnce();
    if (!location.hash) {
      try { history.replaceState(null, '', '#/keyboard'); } catch (err) { location.hash = '#/keyboard'; }
    }
    state.route = parseRoute();
    applyRoute(state.route);
    initTape();
    drawTape();
    bind();
    if (!reduce) setInterval(tick, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
