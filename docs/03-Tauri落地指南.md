# 手脉 · 把原型固化成 Tauri 界面

> 适用范围：把 `design-demos/HandPulse-Prototype.html` 这个可点击原型，变成能长期维护、能接真实采集的 Tauri 2 桌面应用。
> 事实核对（2026-11-04）：Tauri 稳定线 2.12.x（crates.io `tauri` 2.12.5）；`windows` crate 0.62.2；本机 Rust 1.96.0 / Node 26.13.0 / WebView2 156.0.4314.58，可以直接构建；pnpm 未装，用 npm 或先装 pnpm。
> 参考：Tauri 2 文档 [Create a Project](https://v2.tauri.app/start/create-project/) · [Config](https://v2.tauri.app/reference/config/) · [Calling Rust](https://v2.tauri.app/develop/calling-rust/) · [Calling Frontend](https://v2.tauri.app/develop/calling-frontend/) · [Windows Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/using-raw-input)

---

## 0. 先把「固化」拆成三件事

| 层 | 原型里是什么 | 固化后是什么 | 不能直接搬的原因 |
|---|---|---|---|
| 壳 | 浏览器打开一个 HTML | Tauri 窗口 + 权限 + 打包 | 需要原生窗口、CSP、单实例、托盘、自启 |
| 视觉层 | 一个 `<style>` + 一个 `<script>` | 组件 + 设计 token + 图表模块 | 单文件不可维护，改一个页面会牵动全局 |
| 数据层 | `mock-gen.js` 生成 `window.HP` | `invoke` / `Channel` → Rust → SQLite | mock 是假数据，实时流和落盘必须走 Rust |

**核心原则：视觉层尽量原样保留，数据层整层替换。** 这套原型的辨识度在排版、字体、键盘发光和图表，不在技术栈；重写视觉等于把设计再做一遍。

---

## 1. 目标结构

```
HandPulse/
├─ docs/                         现有需求文档（01/02）+ 本文
├─ design-demos/                 原型与截图，作为视觉基准，不打包
│  └─ HandPulse-Prototype.html
├─ app/                          新的 Tauri 工程
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  ├─ styles/
│  │  │  ├─ tokens.css           ← 从原型 :root 抽出来
│  │  │  ├─ shell.css            ← rail / transport / tape / inspector
│  │  │  ├─ keyboard.css
│  │  │  ├─ charts.css
│  │  │  └─ settings.css
│  │  ├─ shell/
│  │  │  ├─ Rail.tsx
│  │  │  ├─ Transport.tsx
│  │  │  ├─ LiveTape.tsx
│  │  │  └─ Inspector.tsx
│  │  ├─ pages/
│  │  │  ├─ KeyboardPage.tsx
│  │  │  ├─ MousePage.tsx
│  │  │  ├─ StatsPage.tsx
│  │  │  └─ SettingsPage.tsx
│  │  ├─ charts/
│  │  │  ├─ LineChart.tsx
│  │  │  ├─ Histogram.tsx
│  │  │  ├─ WeekHeatmap.tsx
│  │  │  ├─ CalendarHeatmap.tsx
│  │  │  └─ DetailTable.tsx
│  │  ├─ ipc/
│  │  │  ├─ types.ts             ← 与 Rust 结构一一对应
│  │  │  ├─ client.ts            ← invoke 封装 + 浏览器 mock 开关
│  │  │  └─ live.ts              ← Channel / 事件 + rAF 批量
│  │  ├─ state/
│  │  │  ├─ appStore.ts          ← 路由/范围/显示模式/选中键
│  │  │  └─ liveStore.ts         ← 10Hz 增量，脱离 React 渲染
│  │  └─ mock/mockGen.ts         ← 原型数据改成 TS，只在浏览器 dev 用
│  └─ src-tauri/
│     ├─ Cargo.toml
│     ├─ tauri.conf.json
│     ├─ capabilities/default.json
│     └─ src/
│        ├─ main.rs
│        ├─ lib.rs
│        ├─ model.rs
│        ├─ commands/
│        │  ├─ mod.rs
│        │  ├─ summary.rs
│        │  ├─ keys.rs
│        │  ├─ buckets.rs
│        │  ├─ history.rs        ← hist / heat / grid / detail
│        │  └─ settings.rs
│        ├─ capture/
│        │  ├─ mod.rs
│        │  ├─ windows_raw.rs    ← Raw Input + 消息窗口
│        │  ├─ aggregator.rs     ← 1s tick / 60s bucket
│        │  └─ ring.rs
│        ├─ store/
│        │  ├─ mod.rs
│        │  ├─ schema.rs
│        │  └─ queries.rs
│        └─ keymap/qwerty-104.json
└─ tools/                        原型截图/检查脚本（保留）
```

为什么放在 `app/`：现有 `design-demos/` 是设计资产，Tauri 工程是产品代码；不要把两者混在一个 `src` 里。

---

## 2. M0：先让原型原样跑进 Tauri（0.5–1 天）

这一步只验证三件事：窗口尺寸、字体、WebView2 渲染。数据仍然是 mock。
两条路线选一条，**推荐 A**：M0 的目标是「跑起来」，组件化留给 M1，避免一次改两件事。

### 路线 A（推荐）：vanilla-ts，把原型原样搬进来

```powershell
cd D:\Code\壳隐\HandPulse
npm create tauri-app@latest app
# 交互选择：npm → Vanilla → TypeScript
cd app
npm install
```

然后把原型拆成 Vite 能吃的形式：

1. `HandPulse-Prototype.html` 的 `<body>` 内容放进 `app/index.html`（保留 `.app` 根节点和所有 id/class）。
2. `<style>` 原样放到 `src/styles/prototype.css`，在 `src/main.ts` 里 `import './styles/prototype.css'`。
3. `<script>`（含 mock-gen 内联部分）放到 `src/legacy/app.ts`，文件头加 `// @ts-nocheck`，在 `src/main.ts` 里 `import './legacy/app'`；确保它在 DOM 之后执行（module script 放 body 末尾）。
4. 字体先继续用 base64（M1 再抽成 `src/assets/fonts/`）；`<title>` 改成「手脉 HandPulse」。
5. `npm run tauri dev`，四页 hash 路由照旧。

优点：半天内能跑，视觉零改动，Tauri 壳的问题和 React 迁移问题不会混在一起。

### 路线 B：react-ts，直接开始组件化

```powershell
npm create tauri-app@latest app
# 交互选择：npm → React → TypeScript
```

按第 4 节的组件映射把原型拆成 `App.tsx` + 四个 page；M0 验收同样是四页视觉一致。缺点是 M0 会同时承担「Tauri 壳」和「React 重写」两件事，出问题时不好定位。

### M0 验收（两条路线相同）

- `npm run tauri dev` 打开原生窗口，1440×900、1100 宽，四页路由、键盘热力、图表和现有截图一致。
- 控制台 0 error；WebView2 下字体和 `backdrop-filter` 正常。
- `npm run build` 通过；`cd src-tauri; cargo check` 通过。
- 原生窗口截一张图，存 `app/screenshots/m0-tauri.png`。

---

## 3. Tauri 壳配置（M0 就定死）

### 3.1 `src-tauri/tauri.conf.json`

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "HandPulse",
  "version": "0.9.0",
  "identifier": "com.handpulse.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "手脉 HandPulse",
        "width": 1440,
        "height": 900,
        "minWidth": 1100,
        "minHeight": 720,
        "resizable": true,
        "center": true,
        "theme": "Dark",
        "backgroundColor": "#000000",
        "visible": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"]
  }
}
```

要点：

- `theme` 和 `backgroundColor` 在 Tauri 2 的 `WindowConfig` 里都有；Windows 上 alpha 会被忽略，所以直接写 `#000000`。
- `style-src 'unsafe-inline'` 是因为原型大量用 `style="left:…"` 画键帽。**先允许，后重构**：M1 把键帽的 inline style 改成 CSS 变量 + `data-*`，再收紧 CSP。
- 不装 `shell`、`fs` 这类高权限插件；导出 CSV 用 dialog 拿路径，写文件在 Rust 里做。
- 先保留系统标题栏。要做无边框标题栏，再给 transport 加 `data-tauri-drag-region`，并处理最小化/最大化/关闭三个原生按钮；这一步不要和视觉迁移一起做。

### 3.2 `src-tauri/capabilities/default.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main",
  "description": "HandPulse 主窗口",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-set-focus"
  ]
}
```

插件权限按需加（`opener:default` / `dialog:default` / `autostart:default`），不要一把梭。`core:default` 已经覆盖事件、窗口基础能力；`allow-show` 只在用 `visible:false` + 首帧后 `show()` 时需要。

### 3.3 首帧不白闪

两种做法，选一个：

- **简单**：`visible: true` + `backgroundColor: "#000000"`，WebView2 先铺黑再渲染。
- **干净**：`visible: false`，React 首帧后 `await getCurrentWindow().show()`，capabilities 加 `core:window:allow-show`，并在 `useEffect` 里只执行一次。

---

## 4. 前端迁移：把「一页 HTML」变成「一个应用」

### 4.1 组件映射

| 原型里的东西 | 组件 | 备注 |
|---|---|---|
| `.rail` | `shell/Rail.tsx` | 4 个路由，`aria-current` |
| `.transport` | `shell/Transport.tsx` | 范围分段、今日读数、暂停 |
| `.tape` | `shell/LiveTape.tsx` | Canvas；非键盘页不渲染 |
| `.view` + `.page` | `App.tsx` 路由 | `HashRouter` 最省事 |
| `#kbc` 键盘 | `keyboard/KeyboardCanvas.tsx` | 命令式渲染，不要每帧重建 |
| `#top10Table` | `keyboard/Top10List.tsx` | 两列五行 |
| `#screenGrid` | `mouse/ScreenGrid.tsx` | 32×18，CSS Grid |
| `#mouseSvg` | `mouse/MouseSvg.tsx` | 静态 SVG + 发光类 |
| 折线/直方/热力/表格 | `charts/*` | 保留 SVG，不换 ECharts |
| `.insp` | `shell/Inspector.tsx` | 按路由渲染不同内容 |
| modal/toast | `ui/Modal.tsx` / `ui/Toast.tsx` | 清空数据、重置视图 |

**技术栈建议**：React + TypeScript + Vite；样式继续用手写 CSS（原型已经是完整设计系统），不引入 Tailwind；图表保留手写 SVG，不引入 ECharts。需求文档里写的 Tailwind + ECharts 是 P0 的技术选型，但这套视觉的图表是产品辨识度的一部分，换库会改掉线宽、色阶、刻度节奏。若团队坚持统一栈，再单独评估。

### 4.2 状态怎么放

- **UI 状态**（路由、范围、显示模式、布局、选中键、暂停）：`useReducer` + Context，或一个 30 行的 `createStore`。
- **实时数据**：不要进 React state。10Hz × 每次 setState = 每秒 10 次全树渲染，1440 个键帽会掉帧。
  - `liveStore.ts` 维护 `Map<keyId, delta>` 和 `dirty` 集合；
  - `KeyboardCanvas` 用 `useEffect` 订阅 store，在 `requestAnimationFrame` 里只改 dirty 的键；
  - 数字读数用 `ref.textContent` 更新，或 `useSyncExternalStore` 只订阅单个数值。
- **历史数据**：`invoke` 拉取，按路由 + 范围缓存；范围切换显示骨架屏（原型里的 loading 态）。

### 4.3 IPC 客户端

```ts
// src/ipc/client.ts
import { invoke } from '@tauri-apps/api/core';
import type { Summary, KeyStat, Bucket, Histogram, Heatmap, DetailPage } from './types';
import * as mock from '../mock/mockGen';

export const isTauri = '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args?: Record<string, unknown>, fallback: () => T): Promise<T> {
  if (!isTauri) return fallback();
  return invoke<T>(cmd, args);
}

export const getSummary = (range: string) =>
  call<Summary>('get_summary', { range }, () => mock.summary(range));

export const getKeyStats = (range: string, layout: number) =>
  call<KeyStat[]>('get_key_stats', { range, layout }, () => mock.keyStats(range, layout));

export const getBuckets = (range: string, granularity: number) =>
  call<Bucket[]>('get_buckets', { range, granularity }, () => mock.buckets(range, granularity));

export const getHistogram = (range: string, dim: string) =>
  call<Histogram>('get_histogram', { range, dim }, () => mock.histogram(range, dim));

export const getHeatmap = (range: string, type: string) =>
  call<Heatmap>('get_heatmap', { range, type }, () => mock.heatmap(range, type));

export const getGrid = (range: string) =>
  call<Array<[number, number, number]>>('get_grid', { range }, () => mock.grid(range));

export const getDetail = (range: string, page: number) =>
  call<DetailPage>('get_detail', { range, page }, () => mock.detail(range, page));
```

Tauri 命令参数默认按 **camelCase** 传给 Rust（官方文档明确说 “Arguments should be passed as a JSON object with camelCase keys”）；Rust 结构体用 `#[serde(rename_all = "camelCase")]` 回传，前端类型就能一一对应。

### 4.4 实时流：优先 Channel，不是事件

Tauri 官方文档明确说：**事件系统不是为低延迟/高吞吐设计的**，流式数据推荐 `tauri::ipc::Channel`。需求文档里的 `live_stream` 事件在 10Hz、单帧 ≤64 键时够用，但 G1 要求 P99 < 30ms，建议直接用 Channel 做基准。

```rust
// src-tauri/src/commands/live.rs
use serde::Serialize;
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFrame {
    pub seq: u64,
    pub ts: u64,
    pub keys: Vec<(u16, u32)>,     // [key_id, delta]
    pub clicks: [u32; 5],          // left/right/middle/side1/side2
    pub wheel: [i32; 2],           // up/down
    pub dx: i32,
    pub dy: i32,
    pub grid: Vec<(u8, u8)>,       // 本帧命中的格子
}

#[tauri::command]
pub fn subscribe_live(channel: Channel<LiveFrame>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.live.subscribe(channel);
    Ok(())
}
```

```ts
// src/ipc/live.ts
import { Channel, invoke } from '@tauri-apps/api/core';
import { liveStore } from '../state/liveStore';

export async function startLive() {
  if (!('__TAURI_INTERNALS__' in window)) return mock.startLive(liveStore);
  const ch = new Channel<import('./types').LiveFrame>();
  ch.onmessage = (f) => liveStore.push(f);
  await invoke('subscribe_live', { channel: ch });
}
```

Channel 是**有顺序**的；事件在异步监听下可能乱序（官方文档的 Common Pitfalls 也写了）。实时高亮必须按 seq 合并，晚到的帧丢弃，不要让它回退计数。

### 4.5 键盘渲染：只改脏键

原型里 `renderKeyboard()` 每次重建 104 个 `<button>`，在 10Hz 下会抖。Tauri 版这样做：

1. 初始化时按 `layout` 建一次 DOM，存 `Map<keyId, HTMLElement>`。
2. 热力/范围变化：遍历所有键，只改 `style.setProperty('--fill', …)` 和 `data-lv`。
3. 实时帧：只对 `frame.keys` 里的 key 加 `.flash`，`setTimeout`/`animationend` 移除；计数读数只更新被点到的。
4. 选中键：改 `aria-pressed` / `.sel`，不重建。
5. 104↔87：切换时重建一次，并重算 `u`。

### 4.6 图表

- 折线 1440 个点：直接一条 `<path>` 没问题；30 天视图先按天聚合，不要画 43k 个点。
- 热力 7×24 是 168 个 `<rect>`；日历 371 个；都在可接受范围。
- 用 `ResizeObserver` 重算 SVG 宽高，避免窗口缩放时变形。
- 图表文字用 `<text>` 而不是 HTML 叠加，导出 PNG 时更稳。
- 每个图表保留 `aria-label` + 可见摘要，原型已经做了。

### 4.7 字体与 CSP

- 字体移到 `src/assets/fonts/`，Vite 会 hash；`@font-face` 用相对 URL。
- CSP 的 `font-src 'self'` 即可；如果继续用 base64，再加 `data:`。
- Inter 和 JetBrains Mono 都是 OFL，可以随应用分发。

### 4.8 路由与窗口

- `HashRouter`（`#/keyboard`）最稳，Tauri 的 `tauri://localhost` 不需要服务端 fallback。
- 路由切换 180ms 淡入 + 上移 4px，保持原型的手感。
- 原生标题栏先留着；transport 不是标题栏，不要给它 `data-tauri-drag-region`，否则点分段控件会拖窗口。

---

## 5. Rust 采集层（M2）

### 5.1 模块与线程

```
UI (WebView2)
   ▲ Channel 10Hz           ▲ invoke 查询
   │                        │
[emitter thread]      [command handlers]
   ▲                        │
[aggregator 1s tick] ── [ring buffer] ── [writer thread] ── SQLite (WAL)
   ▲
[capture thread: Raw Input message-only window]
```

- capture 线程只做解析和原子累加，不分配、不落盘、不碰 UI。
- aggregator 线程每 1s 把原子计数换成快照；60s 关桶时序列化 + zstd。
- emitter 线程每 100ms 读一次「自上次以来的增量」，通过 Channel 推给前端。
- writer 线程独占 SQLite 写连接；用有界 channel，满了丢最旧的桶并记日志，不能阻塞采集。
- 查询命令用只读连接（WAL 下可并发读），或 `spawn_blocking` 包一层。

### 5.2 Raw Input 骨架

```rust
// capture/windows_raw.rs（仅 Windows）
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::Input::{
    RegisterRawInputDevices, GetRawInputData, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::w;

pub fn spawn(tx: Sender<RawEvent>, paused: Arc<AtomicBool>) -> std::io::Result<()> {
    std::thread::Builder::new().name("hp-capture".into()).spawn(move || unsafe {
        let hwnd = CreateWindowExW(
            0, w!("STATIC"), w!("HandPulseSink"),
            0, 0, 0, 0, 0, HWND_MESSAGE, None, None, None,
        ).expect("message-only window");

        let devices = [
            RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x06, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd },
            RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd },
        ];
        RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32)
            .expect("register raw input");

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == WM_INPUT && !paused.load(Ordering::Relaxed) {
                read_raw_input(msg.lParam, &tx);
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    })?;
    Ok(())
}

unsafe fn read_raw_input(lparam: LPARAM, tx: &Sender<RawEvent>) {
    let mut size = 0u32;
    GetRawInputData(HRAWINPUT(lparam.0 as _), RID_INPUT, None, &mut size,
        std::mem::size_of::<RAWINPUTHEADER>() as u32);
    let mut buf = vec![0u8; size as usize];
    GetRawInputData(HRAWINPUT(lparam.0 as _), RID_INPUT, Some(buf.as_mut_ptr() as _), &mut size,
        std::mem::size_of::<RAWINPUTHEADER>() as u32);
    let raw = &*(buf.as_ptr() as *const RAWINPUT);
    match raw.header.dwType {
        RIM_TYPEKEYBOARD => { /* raw.data.keyboard.VKey / MakeCode / Flags */ }
        RIM_TYPEMOUSE => { /* raw.data.mouse.usButtonFlags / usButtonData / lLastX / lLastY */ }
        _ => {}
    }
}
```

关键细节：

- **物理键位**用 `RAWKEYBOARD.MakeCode`（扫描码）映射到 `key_id`，不要用 `VKey`（受键盘布局影响）。`key_def` JSON 里已经有 `scancode_win`。
- **自动重复过滤**：维护 `HashSet<u16>` of pressed scancodes；已经按下的键再来 make，直接忽略；break 时移除。
- **长按**：第一次 make 记 `Instant`；break 时算时长；按住 > 5000ms 的测试必须过。
- **组合键**：keydown 时如果 pressed 集合已有其他键，`chord += 1`。
- **滚轮**：`RI_MOUSE_WHEEL` 的 `usButtonData` 是 `i16`，高精度滚轮可能是 30/60/120；用累加器除以 120 得到逻辑格，余数留到下帧。
- **鼠标位移**：`lLastX/lLastY` 是相对位移；累计绝对值算距离；100ms 窗口算峰值速度。
- **屏幕网格**：点击时 `GetCursorPos` + 主屏尺寸归一化到 32×18，只存格子计数，不存坐标序列。
- **UIPI / 管理员权限**：Raw Input 是旁路监听，但前台是更高完整性级别（管理员）的游戏时，低权限进程可能收不到输入。**不要默认提权**；在设置里说明，真遇到再评估按需提权。
- **反作弊**：只读 Raw Input，不 hook、不注入、不截图；仍需在目标游戏上实测，避免 overlay 行为。

### 5.3 桶与 payload

严格按 `docs/02-原型需求报告.md` 的 `bucket` 表：

- `ts` 是本地时区对齐的桶起点；用 `chrono::Local` 取分钟边界，不要用 UTC。
- `payload` 是 `zstd(JSON)`；键位用 `key_id`，不要用字符。
- 60s 桶关闭才写；崩溃最多丢 1 个桶（G2 验收）。
- 保留 30 天：启动时、每天 04:00 各跑一次清理；清空数据后 `VACUUM`。
- 会话计数在内存，不落盘；「今日」= DB + 当前会话内存。

### 5.4 查询与性能

- `get_summary`、`get_key_stats`、`get_buckets`、`get_histogram`、`get_heatmap`、`get_grid`、`get_detail` 与需求文档 6.2 一一对应。
- 30 天键位统计不要每次解 43k 个 zstd payload。加一张 `agg_day`（或 `key_day`）预聚合表，命令直接读聚合；原型阶段也可以先接受 300ms 内的解码，但要在设置里标“数据较多”。
- 查询命令全部 `async`，内部用 `tauri::async_runtime::spawn_blocking` 包 SQLite 读，避免卡 UI 线程。
- 表格分页 50 行，`LIMIT/OFFSET` 或按 `ts` 游标。

### 5.5 事件与状态

- `pause` / `resume`：Rust 侧 `AtomicBool`；暂停时 aggregator 不写、emitter 不推增量；前端显示暂停遮罩。
- 托盘：`tauri-plugin-tray` 或 Tauri 内置 `TrayIconBuilder`；菜单：打开 / 暂停 / 退出。
- 单实例：`tauri-plugin-single-instance`，第二次启动聚焦主窗口，否则会双份采集。
- 自启：`tauri-plugin-autostart`，登录后默认静默到托盘（产品决策，先做成设置项）。

---

## 6. 存储与导出

```toml
# src-tauri/Cargo.toml（关键依赖）
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.37", features = ["bundled"] }
zstd = "0.13"
chrono = { version = "0.4", features = ["serde"] }
crossbeam-channel = "0.5"
parking_lot = "0.12"
anyhow = "1"
thiserror = "2"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.62", features = [
  "Win32_Foundation",
  "Win32_UI_Input",
  "Win32_UI_WindowsAndMessaging",
  "Win32_UI_HiDpi",
] }
```

DB 路径：`app.path().app_data_dir()?.join("data.db")`；WAL + `synchronous=NORMAL`；`PRAGMA user_version` 做迁移。schema 直接复用需求文档 6.1，先建 `bucket / key_def / pad_bucket / meta`，`pad_bucket` 空表预留。

导出：

- CSV：UTF-8 BOM，列与明细表一致；导出当前筛选范围全部行，不只当前页。
- JSON：含 `schema_version`。
- 文件路径用 `tauri-plugin-dialog` 的保存对话框；写文件在 Rust 里做，前端只拿路径/结果。
- 清空：前端输入 `DELETE`，Rust 再校验一次；事务删除 + `VACUUM`。

---

## 7. 打包

```powershell
cd app
npm run tauri build
# 产物：src-tauri/target/release/bundle/msi/*.msi
#       src-tauri/target/release/bundle/nsis/*-setup.exe
```

- 图标：`npm run tauri icon path\to\icon.png` 生成全套。
- WebView2：默认 `downloadBootstrapper`；离线安装包改成 `embedBootstrapper` 或固定运行时（`bundle.windows.webviewInstallMode`）。
- 签名：Windows 代码签名证书；没有签名会触发 SmartScreen。
- 便携版：NSIS 安装包 + 一个 zip（exe + 资源）；Tauri 本身不产 portable 目标，用脚本打 zip。
- 不接 updater（产品承诺不联网）；升级靠重新安装。

---

## 8. 验收怎么对回需求文档

| 需求 | Tauri 阶段怎么验 |
|---|---|
| P0 四页 / 图表 / 空态 | M0 截图对比；浏览器 mock + Tauri 各跑一遍 |
| 实时高亮 P99 < 30ms | Rust `Instant` 打点 + Channel 帧 `ts`；前端 `rAF` 时间差，采样 1000 帧 |
| 400 APM CPU < 1.5% | 合成输入脚本；任务管理器 / `GetProcessTimes` 10 分钟 |
| 计数误差 0 | 1000 次键盘 + 各 200 次鼠标键；DB 对比 |
| 长按 5000±50ms | 按住 A 5 秒；`hold_ms` 对比 |
| 自动重复过滤 | 30/s 重复率，计数 1 |
| 跨桶连续 | 连续输入 10 分钟跨 60s 边界 |
| 崩溃最多丢 1 桶 | 强杀进程 10 次，DB 可打开 |
| 无非本地连接 | 抓包 24h |
| 无按键顺序字段 | 人工审计 schema |
| 清空后体积回落 | `VACUUM` 前后文件大小 |

---

## 9. 工作拆解（建议顺序）

| 阶段 | 内容 | 人日 |
|---|---|---|
| M0 | Tauri 壳 + 原型原样迁移 + mock 兜底 | 1–2 |
| M1 | React/TS 组件化、样式拆分、字体/CSP、实时 store | 3–4 |
| M2 | Raw Input + aggregator + Channel 实时流 | 5–6 |
| M3 | SQLite + 查询命令 + 数据页接真数据 | 3–4 |
| M4 | 设置/导出/托盘/自启/单实例 | 2–3 |
| M5 | 准确性/性能/崩溃测试 + 打包签名 | 3–4 |

总计约 17–23 人日，和需求文档的 25 人日（含缓冲）对得上。

---

## 10. 最容易踩的坑

1. **把事件系统当高频通道**：Tauri 文档明说事件不适合低延迟/高吞吐；实时流用 `Channel`，事件只做暂停/设置变更。
2. **10Hz 触发 React 全树渲染**：键盘必须命令式更新脏键；否则 1440 个键帽一定掉帧。
3. **CSP 卡住 inline style**：原型大量 `style="left:…"`；要么先 `style-src 'unsafe-inline'`，要么 M1 重构。
4. **用 VKey 当物理键**：必须用扫描码；否则换键盘布局数据就错。
5. **在 capture 线程写 SQLite**：会拖慢输入路径；只原子累加，写盘交给 writer。
6. **默认提权**：会弹 UAC，且与“无感记录”冲突；先不提权，遇到高权限游戏再评估。
7. **双开**：两个采集器会双倍计数；上 `single-instance`。
8. **桶边界用 UTC**：本地时区对齐，否则“今日”会错位；夏令时也要测。
9. **把 30 天明细每次全解压**：加 `agg_day` 预聚合，否则数据页会超过 300ms。
10. **忘了 WebView2 的 DPI**：125%/150% 缩放要验 1440 逻辑像素下的键盘和图表。

---

## 11. 下一步

建议先做 **M0**：把 `HandPulse-Prototype.html` 原样放进 Tauri，确认窗口、字体、四页和截图一致；再接 M1/M2。不要一上来就写 Raw Input，否则视觉还没跑通，采集层的问题会和 UI 问题混在一起。
