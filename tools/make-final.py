# -*- coding: utf-8 -*-
"""从 dir-2（工作台骨架）生成最终混搭版：方向 2 的布局 + 方向 1 的暗厅视觉，并简化。"""
import io, os, re

ROOT = r"D:\Code\壳隐\HandPulse"
SRC = os.path.join(ROOT, "design-demos", "dir-2.html")
DST = os.path.join(ROOT, "design-demos", "HandPulse-Prototype.html")

with io.open(SRC, encoding="utf-8") as f:
    doc = f.read()

# 1) 标题
doc = doc.replace("<title>手脉 HandPulse · 工作台</title>", "<title>手脉 HandPulse · 原型</title>")

# 2) rail 品牌
doc = doc.replace('<div class="rail-brand" aria-hidden="true">脉</div>',
                  '<div class="rail-brand" aria-hidden="true">手脉</div>')

# 3) 四页大标题（方向 1 的 display 语气）
heads = {
    "keyboard": ("键盘使用", "今天按了 12,438 次键。W 出现最多，1,204 次。"),
    "mouse": ("鼠标使用", "今天点了 5,204 次，鼠标移动了约 12.4 公里。"),
    "stats": ("数据展示", "今日峰值 380 次/分，出现在 21:03。"),
    "settings": ("设置", "采集只在本机进行，不联网，也不记录你输入了什么。"),
}
for page, (title, lead) in heads.items():
    # 找到 section 开头，在第一个子元素前插入 header
    marker = re.search(r'<section class="page" data-page="%s"[^>]*>' % page, doc)
    assert marker, page
    insert_at = marker.end()
    header = ('\n        <header class="g-head"><h1>%s</h1><p>%s</p></header>' % (title, lead))
    doc = doc[:insert_at] + header + doc[insert_at:]

# 4) 热力色阶：按需求 7.2（L0 压到近黑，L1–L5 保持原色）
old_levels = """  var LEVELS = [
    { c: '#17191d', ink: '#9aa4b1', bd: '#24282f' },
    { c: '#1b2c46', ink: '#cfd9e8', bd: '#26364f' },
    { c: '#20506f', ink: '#e4eef7', bd: '#2a5a7c' },
    { c: '#24647a', ink: '#eef6fa', bd: '#2b7088' },
    { c: '#7cb464', ink: '#0d130b', bd: '#8fc477' },
    { c: '#f2bd42', ink: '#17130a', bd: '#ffd268' }
  ];"""
new_levels = """  var LEVELS = [
    { c: '#101014', ink: '#8e8e93', bd: '#1a1a1d' },
    { c: '#1D3F6B', ink: '#d7e5f5', bd: '#24486f' },
    { c: '#2A6FA8', ink: '#f2f8fc', bd: '#3579b1' },
    { c: '#46A6C4', ink: '#04161c', bd: '#50b0cd' },
    { c: '#8FD06B', ink: '#0d130b', bd: '#9bda78' },
    { c: '#FFC94A', ink: '#17130a', bd: '#ffd268' }
  ];"""
assert old_levels in doc
doc = doc.replace(old_levels, new_levels)

# 5) 键盘尺寸上限 40 -> 41（暗厅里键盘更大一点）
doc = doc.replace("var u = Math.max(29, Math.min(40, Math.floor(avail / 24)));",
                  "var u = Math.max(29, Math.min(41, Math.floor(avail / 24)));")

# 5.5) 给 body 标记当前路由（非键盘页隐藏 live tape，简化）
old_route = """  function applyRoute(route) {
    state.route = route;"""
new_route = """  function applyRoute(route) {
    state.route = route;
    document.body.setAttribute('data-route', route);"""
assert old_route in doc
doc = doc.replace(old_route, new_route)

# 5.6) 键帽带上热力级别，供 CSS 做“从键缝里透光”的高光
old_key_html = """        + '--fill:' + L.c + ';--ink:' + L.ink + ';--bd:' + L.bd + '">' + esc(label) + '</button>';"""
new_key_html = """        + '--fill:' + L.c + ';--ink:' + L.ink + ';--bd:' + L.bd + '" data-lv="' + lv + '">' + esc(label) + '</button>';"""
assert old_key_html in doc
doc = doc.replace(old_key_html, new_key_html)

# 5.7) 暂停时同步“采集总开关”的视觉状态（dir-2 原版只改了状态灯）
old_pause = """    state.paused = p;
    state.pausedAt = p ? Date.now() : 0;"""
new_pause = """    state.paused = p;
    state.pausedAt = p ? Date.now() : 0;
    var swCollect = $('#swCollect'); if (swCollect) swCollect.setAttribute('aria-checked', String(!p));"""
assert old_pause in doc
doc = doc.replace(old_pause, new_pause)

# 6) 追加“暗厅”皮肤
CSS = r"""
/* =====================================================================
   最终混搭版 · 暗厅 × 工作台
   结构来自方向 2（rail + transport + tape + 工作区 + inspector）
   视觉来自方向 1（纯黑、display 紧字距、单一 Action 蓝、胶囊、无边框、
   键盘作为被顶光打亮的实物、整套只有一处产品阴影）
   ===================================================================== */
:root{
  --bg:#000; --panel:#0a0a0b; --panel-2:#000; --panel-3:#101012;
  --line:rgba(255,255,255,.09); --line-soft:rgba(255,255,255,.06);
  --text:#f5f5f7; --text-2:#c7c7cc; --text-3:#8e8e93; --text-4:#8e8e93;
  --accent:#2997ff; --accent-soft:#9ccaff; --accent-dim:rgba(41,151,255,.12);
  --insp:300px; --keylabel:13px;
}
body{background:#000;font-size:15px;line-height:1.5}
.app{grid-template-columns:64px minmax(0,1fr) var(--insp)}
.view{padding:28px 40px 34px;overflow-y:auto;overflow-x:hidden}
.view::-webkit-scrollbar{width:10px}
.view::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:5px}
.page.active{gap:14px;height:auto;min-height:100%}
.page[data-page="keyboard"].active{height:100%;overflow:hidden}
.g-head{flex:0 0 auto;padding:0 0 4px}
.g-head h1{font-size:46px;font-weight:600;letter-spacing:-.038em;line-height:1.06;margin:0;color:#f5f5f7}
.g-head p{font-size:15px;line-height:1.45;color:#a1a1a6;margin:9px 0 0;letter-spacing:-.006em}

/* rail */
.rail{background:#000;border-right:1px solid rgba(255,255,255,.07);padding:14px 0 18px}
.rail-brand{width:64px;height:40px;border:0;background:none;border-radius:0;font-size:14px;font-weight:600;
  letter-spacing:-.02em;color:#f5f5f7;margin-bottom:30px}
.rail-list{gap:8px}
.rail-btn{position:relative;width:44px;height:44px;border:0;border-radius:12px;color:#8e8e93}
.rail-btn:hover{background:#151517;color:#f5f5f7}
.rail-btn[aria-current="page"]{background:transparent;border-color:transparent;color:#f5f5f7}
.rail-btn[aria-current="page"]::after{content:"";position:absolute;left:50%;bottom:3px;width:3px;height:3px;border-radius:50%;
  background:var(--accent);transform:translateX(-50%)}
.rail-btn svg{width:22px;height:22px;stroke-width:1.4}

/* transport */
.transport{flex:0 0 64px;height:64px;padding:0 40px;background:#000;border-bottom:1px solid rgba(255,255,255,.08);gap:14px}
.tp-title{display:none}
.tp-date{font-size:13px;color:#8e8e93;letter-spacing:.01em}
.status{height:32px;padding:0 12px;border-radius:999px;background:#111113;border:1px solid rgba(255,255,255,.06);
  font-size:13px;color:#c7c7cc}
.status:hover{background:#17171a;border-color:rgba(255,255,255,.12)}
.seg{height:32px;padding:3px;gap:2px;border:0;border-radius:999px;background:#151517}
.seg button{border:0;border-right:0;border-radius:999px;padding:0 13px;font-size:13px;color:#a1a1a6}
.seg button:hover{background:transparent;color:#f5f5f7}
.seg button[aria-pressed="true"]{background:#f5f5f7;color:#0a0a0a;outline:0}
.tp-readout{padding:0 15px;border-left:0;gap:7px}
.tp-readout span{font-size:12px;color:#8e8e93;letter-spacing:.02em}
.tp-readout b{font-size:18px;font-weight:500;letter-spacing:-.02em}
.tp-time{font-size:17px;letter-spacing:-.01em;color:#f5f5f7}
.icon-btn{width:36px;height:36px;border:0;border-radius:999px;background:#151517;color:#c7c7cc}
.icon-btn:hover{background:#1d1d20;color:#f5f5f7}

/* tape：只留一条安静的实时带 */
.tape{flex:0 0 50px;height:50px;padding:0 40px;background:#000;border-bottom:0;gap:12px}
.tape-label{font-size:12px;color:#8e8e93;letter-spacing:.03em}
.tape-meta{font-size:12px;color:#8e8e93}
#tapeCanvas{height:26px;opacity:.92;filter:brightness(1.7) contrast(1.05)}

/* 非键盘页隐藏 live tape，简化并让鼠标/数据页一屏装下 */
body[data-route="mouse"] .tape, body[data-route="stats"] .tape, body[data-route="settings"] .tape{display:none}

/* 所有面板去边框/去卡片感 */
.panel{background:transparent;border:0;border-radius:0}
.ph{flex:0 0 36px;height:36px;padding:0;border-bottom:0;gap:10px}
.ph-title{font-size:13px;font-weight:500;color:#8e8e93;letter-spacing:0}
.ph-meta{font-size:12px;color:#8e8e93}
.ph-spacer{flex:1}
.tbtn{height:30px;padding:0 12px;border:1px solid rgba(255,255,255,.10);border-radius:999px;
  background:transparent;color:#c7c7cc;font-size:13px}
.tbtn:hover{background:#151517;border-color:rgba(255,255,255,.24);color:#f5f5f7}
.tbtn.danger{color:#ff8a8a;border-color:rgba(255,92,92,.32)}
.tbtn.danger:hover{background:#1e1012;border-color:rgba(255,92,92,.55)}

/* 键盘：暗房展品 */
.kb-panel{flex:0 0 auto;position:relative}
.kb-panel .ph-title{display:none}
.kbstage{height:262px;min-height:0;padding:8px 0 6px;position:relative}
.kbstage::before{content:"";position:absolute;left:50%;top:50%;width:min(1000px,96%);height:300px;
  transform:translate(-50%,-50%);pointer-events:none;
  background:radial-gradient(50% 52% at 50% 46%,rgba(76,141,255,.11),rgba(76,141,255,.03) 48%,transparent 72%)}
.kbc{position:relative;z-index:1;filter:drop-shadow(0 28px 60px rgba(0,0,0,.85))}
.key{border:1px solid rgba(255,255,255,.07);border-radius:4px;font-size:13px;font-weight:500;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 0 rgba(0,0,0,.55)}
.key:hover{filter:brightness(1.1)}
.key[data-lv="4"]{box-shadow:0 0 12px rgba(143,208,107,.18),inset 0 1px 0 rgba(255,255,255,.2)}
.key[data-lv="5"]{box-shadow:0 0 18px rgba(255,201,74,.30),inset 0 1px 0 rgba(255,255,255,.38)}
.key.flash{box-shadow:0 0 20px rgba(41,151,255,.75),inset 0 1px 0 rgba(255,255,255,.55);filter:none}
.key.sel{outline:1px solid var(--accent);outline-offset:2px;border-color:var(--accent)}
.page-mask{background:rgba(0,0,0,.72);border-radius:0}
.mask-title{font-size:22px;font-weight:600;letter-spacing:-.02em}
.mask-note{font-size:15px;color:#a1a1a6}
.mask-btn{height:40px;padding:0 18px;border-radius:999px;font-size:14px;background:#2997ff;border:0;color:#001320;font-weight:500}

/* 近 60 分钟带宽：简化掉（transport 的时间轴已经承担实时） */
.band{display:none}

/* Top 10：两列五行，去掉表格框 */
.top10{flex:1 1 auto;min-height:0}
.top10 .ph{flex:0 0 30px}
.top10-table{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;
  grid-template-rows:repeat(5,minmax(0,1fr));gap:0 56px;padding:0;overflow:visible}
.t10-head{display:none}
.t10-row{height:auto;min-height:0;grid-template-columns:22px 78px minmax(0,1fr) 74px 52px;
  gap:10px;padding:0 2px;border-bottom:1px solid rgba(255,255,255,.05);border-radius:0}
.t10-row:hover{background:rgba(255,255,255,.04)}
.t10-row.is-sel{background:rgba(41,151,255,.08)}
.t10-rank{font-size:12px;color:#8e8e93}
.t10-key{font-size:14px;color:#f5f5f7}
.t10-key .mono{font-size:12px;color:#8e8e93}
.t10-bar{height:4px;border-radius:2px;background:#1a1a1c}
.t10-bar i{border-radius:2px}
.t10-count{font-size:14px;color:#f5f5f7}
.t10-share{font-size:12px;color:#8e8e93}

.kbfoot{flex:0 0 38px;gap:18px;padding:0}
.legend{gap:10px}
.legend-title{font-size:12px;color:#8e8e93}
.legend-item{font-size:12px;color:#8e8e93;gap:5px}
.legend-item i{width:9px;height:9px;border-radius:2px;border:0}
.chip{height:30px;padding:0 11px;border-radius:999px;border:1px solid rgba(255,255,255,.10);
  background:transparent;font-size:12px;color:#c7c7cc}
.chip:hover{border-color:rgba(255,255,255,.26);color:#f5f5f7}
.chip.is-sel{background:#f5f5f7;border-color:#f5f5f7;color:#0a0a0a}
.foot-note{font-size:12px;color:#8e8e93}

/* 鼠标 */
.mouse-top{flex:0 0 auto;grid-template-columns:minmax(0,1fr) 320px;gap:36px;min-height:0}
.grid-panel{overflow:visible;position:relative}
.screenwrap{padding:0;height:349px;aspect-ratio:auto}
.screen{max-width:620px;margin:0 auto;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.16);border-radius:6px;gap:1px}
.cell{background:#0a0a0b;color:#8e8e93;font-size:11px}
.cell.has{color:var(--ink)}
.cell:hover{filter:brightness(1.15)}
.screen-foot{flex:0 0 28px;height:28px;padding:0;font-size:12px;color:#8e8e93;border-top:1px solid rgba(255,255,255,.06)}
.metric-panel .metrics{flex:1 1 auto;display:flex;flex-direction:column;gap:0;padding:0;overflow:visible}
.metric{height:45px;flex-direction:row;align-items:baseline;justify-content:space-between;gap:12px;
  border-bottom:1px solid rgba(255,255,255,.06)}
.metric-l{font-size:12px;color:#8e8e93}
.metric-v{font-size:19px;font-weight:500;letter-spacing:-.02em;text-align:right}
.metric-v small{font-size:12px;color:#8e8e93;margin-left:2px}
.rhythm,.dist{display:none}
.mouse-bottom{flex:1 1 auto;grid-template-columns:300px minmax(0,1fr);gap:36px;margin-top:0;min-height:242px}
.mouseshape{padding:0}
#mouseSvg{width:100%;height:auto;max-height:none}
.m-case{fill:#141416;stroke:#2a2a2d;stroke-width:1}
.m-btn{fill:#1c1c1f;stroke:#2e2e31;stroke-width:1}
.m-btn.lit{fill:#2A6FA8;stroke:#46A6C4}
.m-wheel{fill:#232327;stroke:#3a3a3e}
.m-wheel.lit{fill:#2A6FA8;stroke:#46A6C4}
.m-side{fill:#1c1c1f;stroke:#2e2e31}
.m-side.lit{fill:#2A6FA8;stroke:#46A6C4}
.m-txt{fill:#f5f5f7;font-size:12px}
.m-lbl{fill:#8e8e93;font-size:12px}
.m-num{fill:#f5f5f7;font-size:12px}
.hotspots{overflow:visible}
.hs-row{height:36px;border-bottom:1px solid rgba(255,255,255,.06);border-radius:0;gap:12px}
.hs-row:hover{background:rgba(255,255,255,.04)}
.hs-row.is-sel{background:rgba(41,151,255,.08)}
.hs-rank,.hs-zone{font-size:12px;color:#8e8e93}
.hs-pos{font-size:14px;color:#f5f5f7}
.hs-count{font-size:14px}
.hs-bar{height:4px;background:#1a1a1c;border-radius:2px}
.hotspot-note{font-size:12px;color:#8e8e93;line-height:1.7;padding:10px 0 0}

/* 数据 */
.stat-top{flex:0 0 290px}
.stat-mid{flex:0 0 236px;grid-template-columns:1fr 1fr;gap:40px}
.stat-table{flex:0 0 300px}
.stat-top .ph,.stat-mid .ph,.stat-table .ph{flex:0 0 36px;height:36px;border-bottom:0}
.chart-note{font-size:14px;color:#c7c7cc;padding:0;height:26px;flex:0 0 26px}
.line-readout{font-size:12px;color:#8e8e93}
.t-head,.t-row{grid-template-columns:130px 1fr 1fr 1fr 1fr;padding:0 2px}
.t-head{color:#8e8e93;border-bottom:1px solid rgba(255,255,255,.08)}
.t-row{height:27px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05);color:#c7c7cc}
.t-row:hover{background:rgba(255,255,255,.04)}
.pager{border-top:1px solid rgba(255,255,255,.07);padding:0;margin-top:4px;height:44px}
.pg-btn{border-radius:999px;border-color:rgba(255,255,255,.10)!important;background:transparent!important;height:28px!important}
.pg-btn:hover:not(:disabled){border-color:rgba(255,255,255,.28)!important}

/* 设置 */
.settings-wrap{max-width:820px;padding-bottom:44px}
.pref-group{margin-bottom:34px}
.pref-head{font-size:22px;font-weight:600;letter-spacing:-.025em;color:#f5f5f7;
  padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.09);margin-bottom:0}
.pref-row{padding:16px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.pref-name{font-size:16px;letter-spacing:-.01em}
.pref-hint{font-size:13px;color:#8e8e93;margin-top:4px;line-height:1.55}
.pref-ctl{gap:10px}
.path{font-size:13px;color:#c7c7cc;background:#0d0d0f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:7px 10px}
.privacy{margin-top:14px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06)}
.privacy p{font-size:15px;line-height:1.85;color:#c7c7cc;margin-bottom:8px}
.banner{border-radius:12px;border-color:rgba(245,166,35,.35);background:#151108;color:#e7c47a}
.ver{font-size:14px;color:#c7c7cc}
.ver span{font-size:12px;color:#8e8e93}
.switch{width:46px;height:26px;border-radius:13px;background:#252528;border:1px solid #343438}
.switch span{width:20px;height:20px;top:2px;left:2px;background:#c7c7cc}
.switch[aria-checked="true"]{background:#2997ff;border-color:#2997ff}
.switch[aria-checked="true"] span{transform:translateX(20px);background:#fff}

/* inspector */
.insp{background:#000;border-left:1px solid rgba(255,255,255,.07)}
.insp-head{flex:0 0 64px;height:64px;padding:0 24px;border-bottom:1px solid rgba(255,255,255,.07);gap:10px}
.insp-title{font-size:13px;font-weight:500;color:#8e8e93}
.insp-sub{font-size:12px;color:#8e8e93}
.insp-x{width:30px;height:30px;border-radius:999px;color:#8e8e93}
.insp-x:hover{background:#151517;border-color:transparent;color:#f5f5f7}
.insp-body{padding-bottom:28px}
.insp-sec{padding:20px 24px;border-bottom:1px solid rgba(255,255,255,.06)}
.sec-head{font-size:12px;color:#8e8e93;margin-bottom:12px;letter-spacing:.02em}
.hero{padding:24px 24px 6px;gap:16px}
.hero-key{font-size:44px;font-weight:600;letter-spacing:-.04em}
.hero-name{font-size:14px;color:#c7c7cc}
.hero-rank{font-size:12px;color:#8e8e93}
.hero-meter{height:3px;background:#1a1a1c;margin:6px 24px 8px}
.hero-meter i{background:#2997ff}
.hero-note{padding:0 24px 16px;font-size:12px;color:#8e8e93;gap:8px}
.rows{padding:0 24px}
.row{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px;gap:16px}
.row span{font-size:12px;color:#8e8e93}
.row b{font-size:15px;font-weight:500;color:#f5f5f7}
.row b em{font-size:12px;color:#8e8e93}
.insp-p{font-size:14px;line-height:1.8;color:#a1a1a6;padding:16px 24px 0}
.insp-rule{font-size:12px;color:#8e8e93;padding:12px 24px 0;line-height:1.7}
.insp-empty{font-size:14px;line-height:1.8;color:#8e8e93}
.zone-hero{font-size:22px;letter-spacing:-.02em}
.zone-num{font-size:24px;font-weight:600}
.kg div{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px}
.kg b{font-size:14px}
.kg span{font-size:12px;color:#8e8e93}

/* modal / toast */
.modal{background:rgba(0,0,0,.78);backdrop-filter:blur(10px)}
.modal-panel{width:440px;background:#0d0d0f;border:1px solid rgba(255,255,255,.14);border-radius:20px;box-shadow:0 40px 100px rgba(0,0,0,.7)}
.modal-head{height:56px;padding:0 22px;border-bottom:1px solid rgba(255,255,255,.08);font-size:16px}
.modal-body{padding:22px}
.modal-p{font-size:14px;line-height:1.7;color:#c7c7cc}
.modal-input{height:42px;border-radius:12px;background:#000;border:1px solid rgba(255,255,255,.16);font-size:14px;padding:0 14px}
.modal-input:focus{border-color:#2997ff}
.modal-actions{gap:10px;margin-top:18px}
.modal-actions .btn{height:38px;padding:0 18px;border-radius:999px;font-size:14px;border-color:rgba(255,255,255,.12);background:transparent}
.modal-actions .btn:hover{border-color:rgba(255,255,255,.3);color:#f5f5f7}
.modal-actions .btn.primary{background:#2997ff;border-color:#2997ff;color:#001320}
.modal-actions .btn.danger{background:#3a1618;border-color:rgba(255,92,92,.5);color:#ffd7d7}
.toast{border-radius:999px;background:#151517;border:1px solid rgba(255,255,255,.14);padding:11px 18px;font-size:14px}

@media (max-width:1279px){
  :root{--insp:272px}
  .g-head h1{font-size:40px}
  .tp-readout:nth-of-type(3){display:none}
  .mouse-top{grid-template-columns:minmax(0,1fr) 280px;gap:28px}
}
@media (max-width:1239px){
  .app{grid-template-columns:64px minmax(0,1fr)}
  .view{padding:24px 32px 30px}
}
@media (max-height:760px){
  .g-head h1{font-size:38px}
  .kbstage{height:230px}
  .tape{display:none}
}
"""
doc = doc.replace("</style>", CSS + "\n</style>", 1)

# 7) 字体 base64 内嵌，交付为真正的单文件（不依赖 assets 目录）
import base64
FONTS = {
    "assets/fonts/InterVariable.woff2": "font/woff2",
    "assets/fonts/jetbrains-mono-latin-400-normal.woff2": "font/woff2",
    "assets/fonts/jetbrains-mono-latin-500-normal.woff2": "font/woff2",
}
for rel, mime in FONTS.items():
    path = os.path.join(ROOT, "design-demos", rel.replace("/", os.sep))
    with open(path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    doc = doc.replace("url('%s')" % rel, "url(data:%s;base64,%s)" % (mime, b64))

with io.open(DST, "w", encoding="utf-8") as f:
    f.write(doc)
print("written", DST, len(doc))

