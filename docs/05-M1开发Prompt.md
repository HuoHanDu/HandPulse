# M1 开发 Prompt（复制给新对话）

> 前置：M0 已完成（`app/` 里的 Tauri 2 + 原样原型），但还没有 git。
> 本次先提交 M0 基线，再做 M1：React/TS 组件化 + 字体/样式拆分 + 类型化 IPC 边界（仍用 mock，不接 Rust 采集）。

---

# 任务：HandPulse M1 — 先提交 M0 基线，再做 React/TS 组件化与数据接口抽象

## 0. 身份与当前状态

你是 HandPulse（手脉）项目的开发工程师。工作目录：`D:\Code\壳隐\HandPulse`（Windows，路径含中文，命令加引号）。

M0 已经做完：`app/` 是一个 Tauri 2 工程，用 vanilla-ts + Vite 把现有原型原样搬了进来，数据仍是 mock，没有真实采集。已知事实：

- `app/package.json`：name `app`，version 0.9.0；Vite 8.3.5，TypeScript 6.0.3，`@tauri-apps/cli` 2.12.4。
- `app/src-tauri`：Tauri 2 壳，窗口 1440×900、min 1100×720、深色、黑色背景。
- `app/src/legacy/mock.ts` + `app/src/legacy/app.ts`：原型脚本原样搬入（`@ts-nocheck`）。
- `app/src/styles/prototype.css`：约 566 KB，其中大部分是 base64 字体。
- `app/index.html`：原型的整个 `<body>` 结构 + `<script type="module" src="/src/main.ts">`。
- `npm run build` 通过；`cargo check` 通过；四页浏览器截图在 `app/screenshots/m0-web-*.png`；原生窗口截图 `m0-tauri.png` 是全屏截图（包含桌面其他内容）。
- 当前根目录**没有 git 仓库**。`app/src-tauri/target` 已经 4.5 GB，`app/node_modules` 75 MB，绝不能入库。

本次 M1 的目标：**不改变视觉**，把 M0 的单文件式前端拆成可维护的 React/TS 组件；把字体和 CSS 拆出来；建立类型化的 IPC 边界和实时数据 store，仍然用 mock 跑通。真实 Rust 采集、SQLite、托盘、打包都不在本次范围。

## 必读（按顺序）

1. `docs/03-Tauri落地指南.md` 第 4 节「前端迁移」和第 5 节「Rust 采集层」的开头（理解边界即可）。
2. `docs/04-M0开发Prompt.md`：M0 的范围和验收，避免把 M0 的问题当成 M1 的需求。
3. `design-demos/HandPulse-Prototype.html`：视觉与交互基准。M1 的验收标准是「和它一致」。
4. `app/index.html`、`app/src/legacy/app.ts`、`app/src/styles/prototype.css`：M0 的实际产物，完整读一遍。
5. `app/screenshots/m0-web-*.png`、`app/screenshots/m0-web-1100.png`：对齐截图。
6. `docs/02-原型需求报告.md` 第 4、5.1–5.4、7 节：四页内容与可读性底线。
7. `README.md`、`spec.md`、`direction-approved.md`：数据口径与设计选择。

只读：`design-demos/`、`docs/`、根目录的 `README.md` / `spec.md` / `direction-approved.md` / `directions.md`。不要修改它们；M1 只改 `app/`。

## 环境

- Windows；Rust 1.96 / cargo；Node 26 / npm；pnpm 未安装，用 npm。
- WebView2 156 已安装；Tauri 2.12.x。
- 不要用 `pnpm`；不要引外部 CDN；不要联网请求。

---

## 阶段 0：Git 基线（必须先做，做完才允许改代码）

原因：没有 git 的情况下做 React 重构，一旦改坏无法回退；而且 `target` 4.5 GB 不能进仓库。

### 0.1 初始化

```powershell
cd 'D:\Code\壳隐\HandPulse'
git rev-parse --show-toplevel
# 如果报 fatal: not a git repository
git init
```

### 0.2 根目录 `.gitignore`

在仓库根创建 `.gitignore`（嵌套的 `app/.gitignore`、`app/src-tauri/.gitignore` 保留，不要删）：

```gitignore
# 本机设计偏好/外观账本，不属于项目源码
.huishu-design/

# 前端依赖与构建产物
app/node_modules/
app/dist/
app/dist-ssr/

# Rust 构建产物（4.5 GB，绝对不能入库）
app/src-tauri/target/
app/src-tauri/gen/schemas/

# 日志与本地环境
*.log
npm-debug.log*
.env
.env.*

# 系统/编辑器
.DS_Store
Thumbs.db
```

### 0.3 处理全屏截图（隐私）

`app/screenshots/m0-tauri.png` 是 2560×1440 全屏截图，包含用户桌面上其他应用和文档标题，**不要原样入库**。

优先做法：裁成只含应用窗口的图。可以在应用窗口打开时用 PowerShell 调 `GetWindowRect` 拿窗口矩形，再 `CopyFromScreen` 只截那块；或者用 Python/PIL 按截图中的窗口边界裁剪。裁完覆盖 `m0-tauri.png`，确认图里只有应用。

如果 10 分钟内裁不干净：删除 `m0-tauri.png`，把它加进 `.gitignore`，保留 `m0-web-*.png`，并在报告里注明「原生窗口已人工验证，截图因隐私不入库」。

### 0.4 提交 M0 基线

```powershell
git add -A
git status --short
git diff --cached --stat
```

**检查清单**：不要出现 `app/node_modules/`、`app/dist/`、`app/src-tauri/target/`、`app/src-tauri/gen/schemas/`、`.huishu-design/`、全屏截图。确认后再提交：

```powershell
git commit -m "chore(m0): baseline — Tauri 2 shell + prototype port"
git log --oneline -1
git status --short
```

记录 commit hash。**这一提交必须是 M0 原样（除了 .gitignore 和截图处理），不要顺手修 M0 的问题**；修复放在 M1 的提交里。

---

## 阶段 1：M1 的具体工作

按下面顺序做，每完成一块就提交，不要最后一次性大提交。

### 1.1 元数据与 M0 遗留问题

- `app/package.json`：`"name": "handpulse"`，version 保持 0.9.0。
- `app/src-tauri/Cargo.toml`：
  - `name = "handpulse"`
  - `[lib] name = "handpulse_lib"`
  - `version = "0.9.0"`
  - `description = "HandPulse desktop prototype"`
  - `authors = ["HandPulse"]`
- 同步 `app/src-tauri/src/main.rs` 的 `handpulse_lib::run()`。
- 改完 `package.json` 后跑一次 `npm install` 更新 `package-lock.json`；改完 Cargo 包名后跑 `cargo check` 更新 `Cargo.lock`。
- `app/README.md` 换成项目自己的说明（如何 dev/build、目录结构、M0/M1 状态），不要保留模板文案。
- `app/index.html`：
  - `<body data-route="keyboard">`（避免首帧路由样式闪烁）。
  - `<meta name="color-scheme" content="dark">`。
  - `<meta name="theme-color" content="#000000">`。
- `app/vite.config.ts`：加 `@types/node`，删掉 `// @ts-expect-error`。
- `app/src/legacy/app.ts` 顶部重复的 `const HP = (window as any).HP;` 删掉（IIFE 里已有 `var HP = window.HP`）。
- **Tauri dev CSP / HMR**：Tauri 2 在未配置 `devCsp` 时会把生产 `csp` 注入 dev。当前 `connect-src` 只有 `ipc:` 和 `http://ipc.localhost`，Vite HMR 的 WebSocket 会被拦。给 `app/src-tauri/tauri.conf.json` 的 `app.security` 加：
  ```json
  "devCsp": "default-src 'self'; connect-src ipc: http://ipc.localhost http://localhost:1420 ws://localhost:1420 ws://localhost:1421; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'"
  ```
  生产 `csp` 保持收紧。改完实际跑 `npm run tauri dev`，改一行 CSS 验证 HMR 是否生效；不生效再查控制台，不要猜。
- 提交：`chore(m1): metadata, dev csp and M0 housekeeping`

### 1.2 字体与样式拆分

- 从 `prototype.css` 提取 3 个 base64 `@font-face`（Inter、JetBrains Mono 400/500）到：
  - `app/src/assets/fonts/InterVariable.woff2`
  - `app/src/assets/fonts/jetbrains-mono-400.woff2`
  - `app/src/assets/fonts/jetbrains-mono-500.woff2`
  用一次性 Node/Python 脚本解码，脚本可以留在 `tools/` 或不提交；CSS 里改成 Vite 相对 URL。CSS 体积应从 ~566 KB 降到 ~30 KB。
- 把 CSS 拆成 `app/src/styles/`：
  - `tokens.css`（`:root` 变量）
  - `base.css`（reset、body、字体、滚动条）
  - `shell.css`（rail / transport / tape / view）
  - `keyboard.css`
  - `mouse.css`
  - `stats.css`
  - `settings.css`
  - `inspector.css`
  - `overlay.css`（modal / toast）
  - `index.css` 只做 `@import`
  保持选择器、类名、数值不变；这一步只搬家，不改视觉。
- 字体改成 `font-src 'self'` 后，确认 CSP 里仍允许（`data:` 可保留但不依赖）。
- 提交：`refactor(m1): extract fonts and split styles`

### 1.3 React 外壳与四页组件

- 依赖：
  ```powershell
  cd 'D:\Code\壳隐\HandPulse\app'
  npm install react react-dom
  npm install -D @vitejs/plugin-react @types/react @types/react-dom @types/node
  ```
- `vite.config.ts` 加 `react()`；`tsconfig.json` 加 `"jsx": "react-jsx"`，`"types": ["vite/client", "node"]`；`main.ts` → `main.tsx`，挂载 `<App />`。
- `index.html` 缩减为 `<div id="root"></div>` + `<script type="module" src="/src/main.tsx">`；原型的 `.app` 外壳和四页结构交给 React `App` 渲染（`#root{height:100%}`，`App` 返回 `<div className="app" id="app">`）。不要把旧 body markup 和 React 树同时留在页面里。
- 路由/页面切换时由 React 同步 `document.body.dataset.route`，保证 CSS 里的 `body[data-route="mouse"]` 等规则生效。
- 组件结构（可微调，但不要少于这些职责）：
  ```
  src/
  ├─ main.tsx
  ├─ App.tsx
  ├─ app/router.ts            # 30 行 hash router，不引 react-router
  ├─ app/store.ts             # route/range/disp/layout/sel/paused/empty 等
  ├─ shell/Rail.tsx
  ├─ shell/Transport.tsx
  ├─ shell/LiveTape.tsx
  ├─ shell/Inspector.tsx
  ├─ pages/KeyboardPage.tsx
  ├─ pages/MousePage.tsx
  ├─ pages/StatsPage.tsx
  ├─ pages/SettingsPage.tsx
  ├─ keyboard/KeyboardCanvas.tsx
  ├─ keyboard/Top10List.tsx
  ├─ keyboard/LegendChips.tsx
  ├─ mouse/ScreenGrid.tsx
  ├─ mouse/MouseSvg.tsx
  ├─ mouse/MetricList.tsx
  ├─ mouse/Hotspots.tsx
  ├─ charts/LineChart.tsx
  ├─ charts/Histogram.tsx
  ├─ charts/WeekHeatmap.tsx
  ├─ charts/CalendarHeatmap.tsx
  ├─ charts/DetailTable.tsx
  ├─ ui/Modal.tsx
  ├─ ui/Toast.tsx
  ├─ ui/Segmented.tsx
  ├─ ui/Switch.tsx
  ├─ mock/mock.ts             # 从 legacy/mock.ts 搬来，保留数据
  ├─ ipc/types.ts
  ├─ ipc/client.ts
  ├─ ipc/live.ts
  └─ state/liveStore.ts
  ```
- **保留原型的 DOM class 和 CSS**，这样视觉不变。不要为了 React 重命名 class。
- 路由：hash 路由照旧 `#/keyboard` 等，用 `useSyncExternalStore` 或 `useEffect + hashchange`，不引 router 库。
- 状态：`useReducer` + Context 或一个 30 行 store；不要引 Redux/Zustand。
- 键盘渲染的关键要求：
  - 初始化按 layout 建一次 104/87 个键，存 `Map<keyId, HTMLElement>`；
  - 热力/范围变化只改 `--fill` / `data-lv`；
  - 实时帧只给脏键加 `.flash`，不要重建整个键盘；
  - 104↔87 切换才重建。
- 图表：保留手写 SVG（LineChart / Histogram / WeekHeatmap / CalendarHeatmap），不要引 ECharts；把 legacy 里的 SVG 生成函数搬进组件，用 `useEffect` + `ref` 或直接返回 JSX 均可，保持线宽、色阶、刻度不变。
- 提交：`refactor(m1): react shell and page components`（如果太大，拆成 shell / keyboard / mouse+stats 三个提交）。

### 1.4 类型化 IPC 边界与 live store（仍用 mock）

- `src/ipc/types.ts` 定义与 Rust 将来一一对应的类型（camelCase）：
  ```ts
  export type RangeKey = 'session' | 'today' | 'week' | 'month';
  export interface Summary { actions: number; keys: number; clicks: number; moveKm: number; }
  export interface KeyStat { keyId: number; label: string; count: number; ratio: number;
    holdAvgMs: number; holdMaxMs: number; firstTs: number; lastTs: number; }
  export interface Bucket { ts: number; actions: number; keys: number; clicks: number; movePx: number; }
  export interface Histogram { dim: 'key' | 'hour' | 'gap'; items: Array<{ label: string; value: number }>; }
  export interface Heatmap { type: 'week_hour' | 'calendar'; cells: Array<{ x: number; y: number; v: number }>; max: number; }
  export interface DetailRow { ts: number; actions: number; keys: number; clicks: number; moveCm: number; }
  export interface LiveFrame { seq: number; ts: number; keys: Array<[number, number]>;
    clicks: [number, number, number, number, number]; wheel: [number, number];
    dx: number; dy: number; grid: Array<[number, number]>; }
  ```
- `src/ipc/client.ts`：`invoke` 封装 + `isTauri` 判断；浏览器 dev 时回退 `mock`。命令名先按需求文档 6.2：`get_summary` / `get_key_stats` / `get_buckets` / `get_histogram` / `get_heatmap` / `get_grid` / `get_detail`。M1 不实现 Rust 命令，全部走 mock；但边界要先定好。
- `src/ipc/live.ts`：先用 `setInterval` 100ms 的 mock ticker 产 `LiveFrame`；接口保留 `startLive(): Promise<() => void>`，M2 换成 `Channel` 时前端不改调用点。
- `src/state/liveStore.ts`：
  - 累积帧、按 `seq` 去重、`requestAnimationFrame` 批量 flush；
  - 暴露 `subscribe(cb)`、`getDeltas()`、`reset()`；
  - 键盘组件订阅后只更新脏键；
  - `document.hidden` 时暂停 UI flush（采集端以后不受影响）。
- 删除 `src/legacy/` 的运行时依赖；如果暂时保留文件作对照，不要被 `main.tsx` import，并在 M1 结束前删掉。
- 提交：`feat(m1): typed ipc boundary and live store`

### 1.5 验证与提交

1. `npm run build` 通过；`cd src-tauri; cargo check` 通过。
2. `npm run tauri dev` 打开原生窗口；四页都能点；HMR 生效（改 CSS 立即更新）。
3. 浏览器 `npm run dev` 四路由控制台 0 error；1440 / 1100 无横向滚动。
4. 截图：`app/screenshots/m1-web-keyboard/mouse/stats/settings.png`、`m1-web-1100.png`、`m1-tauri.png`（只含窗口）。和 `m0-web-*` 对比，视觉应一致；有差异就修。
5. 键盘实时高亮仍然工作；104/87、显示模式、范围、Top10、键详情、暂停；鼠标图层；直方/热力 tab；设置开关与清空确认。
6. `git status --short` 干净；`git log --oneline` 至少有：
   - `chore(m0): baseline — Tauri 2 shell + prototype port`
   - `chore(m1): metadata, dev csp and M0 housekeeping`
   - `refactor(m1): extract fonts and split styles`
   - `refactor(m1): react shell and page components`
   - `feat(m1): typed ipc boundary and live store`

## 验收清单

- [ ] M0 基线 commit 在 M1 改动之前。
- [ ] 仓库里没有 `node_modules` / `dist` / `target` / `gen/schemas` / `.huishu-design` / 全屏桌面截图。
- [ ] React 组件树；`main.tsx` 不再 import `legacy/app.ts`。
- [ ] 字体在 `src/assets/fonts/`，CSS 已拆分，`prototype.css` 不再有 base64。
- [ ] 四页与 M0 截图视觉一致；1440/1100 无横向滚动；控制台 0 error。
- [ ] `npm run build`、`cargo check`、`npm run tauri dev` 全部通过；Tauri dev 下 HMR 生效。
- [ ] `src/ipc/*` + `state/liveStore.ts` 存在，mock 回退可用；真实采集仍未接。
- [ ] 提交历史清晰，工作区干净。

## 非目标（本次不要做）

- 不写 Rust Raw Input、SQLite、真实 IPC 命令、导出、托盘、自启、单实例、打包。
- 不换 Tailwind / ECharts / react-router / 状态库；不加不必要依赖。
- 不改视觉、不改文案、不改 design-demos；原型就是标准。
- 不做「顺便优化一下」的 UI 改动；只做工程化和数据边界。

## 规则

- Windows PowerShell；中文路径加引号。
- 先读后改；每个提交前看 `git diff --cached --stat`，确认没有大文件。
- 不要 amend 或重写 M0 基线 commit；后续都是新 commit。
- 遇到报错：读完整错误、查 Tauri 2 文档、最小化复现；不要靠猜改配置。
- 失败就如实报告，不要声称完成而没有跑过 build / cargo check / tauri dev / 截图。

## 最终报告（简短）

1. M0 基线 commit hash；M1 的 commit 列表。
2. 目录结构变化；字体/CSS 拆分结果。
3. IPC 类型与 mock 回退的实现位置；live store 的批量策略。
4. 验证结果：build / cargo check / tauri dev / HMR / 控制台 / 1440·1100 / 截图路径。
5. 修掉的 M0 遗留问题；仍然存在的偏差（诚实写）。
