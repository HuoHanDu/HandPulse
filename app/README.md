# 手脉 HandPulse · app

Windows 桌面常驻应用「手脉」的 Tauri 2 工程。界面沿用已定稿原型（`../design-demos/HandPulse-Prototype.html`）。
M3 起 Tauri 下的历史数据来自本机 SQLite；浏览器 dev 仍回退 mock。不联网、不读取输入内容。

## 状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | Tauri 2 壳 + 原型原样迁移（vanilla-ts） | 已完成 |
| M1 | React/TS 组件化、字体与样式拆分、类型化 IPC 边界 + live store（仍 mock） | 已完成 |
| M2 | Windows Raw Input + Aggregator + `Channel<LiveFrame>` 实时层（历史仍 mock） | 已完成 |
| M3 | SQLite 落盘、真实历史查询、四页接真实数据、设置持久化 | 已完成 |
| M4+ | CSV/JSON 导出、开机自启、打包签名（托盘/后台运行已提前实现） | 未开始 |

## Demo 状态（本次收尾）

- M3 已完成：真实落盘、历史查询、设置持久化、清空/VACUUM、四页真实数据。
- Windows 原生标题栏已关闭，改为应用内自绘标题栏（拖动 / 双击最大化 / 最小化 / 最大化还原 / 关闭）。
- M4 能力仍为占位：导出 CSV/JSON、打开数据目录、开机自启均**禁用并标 M4**，不会假装可用。
- Windows 11 Snap Layouts 的分屏菜单依赖原生标题栏，自绘标题栏的 demo **暂无 Snap 菜单**；
  后续可接 `tauri-plugin-frame`。
- 清空数据后进入明确空态；浏览器 mock 仍可“恢复演示数据”，Tauri 下按钮为“开始记录”。
- 无边框窗口补了 8 个缩放热区 + `WS_THICKFRAME`，四边/四角可拖动缩放。
- 单实例：第二次启动会聚焦已有窗口并退出，避免两个采集器重复计数。
- 关闭/重开不会回档：同一分钟的两个不完整桶会合并；重放同一个桶仍保持幂等。
- 关闭窗口时可选择“每次询问 / 最小化到托盘 / 直接退出”；托盘模式关闭后继续采集，
  首次关闭会弹窗并可记住选择。托盘菜单可重新显示或退出。
- 设置页“打开目录”可在资源管理器打开数据库目录；“导入旧数据库”会选择旧版
  data.db，退出重开后替换，并自动备份当前库到 data.db.bak-*。
- 设置页现在是中间内容区和右侧检查器各自独立滚动，内容较长时不会再被裁掉。
- 新增“手柄适配”页：Xbox / PlayStation / Switch 三套手柄示意图（底图取自
  GamepadTester.cn，按本项目的深色主题重新映射），按键、摇杆、扳机实时显示；
  XInput 按键按下会写入 pad_bucket，可在数据浏览的手柄页查看。
- 数据展示新增“月历”热力图；新增“数据浏览”页，可自选开始/结束时间查看分钟明细，
  并支持总览 / 键盘 / 鼠标 / 手柄四个详情页。
- 鼠标页改为固定高度布局，不再需要滚动。
- 采集状态增加“最后事件/前台权限”诊断：前台应用以管理员权限运行时，Raw Input 可能受
  Windows UIPI 限制，设置页会明确提示。
- 仓库不包含演示 DB/WAL；新机器首次启动为空库，采集后自动建库。
- 安装包未签名：`npm run tauri build` 可生成 NSIS/MSI，但对外分发前需要代码签名。

## 打安装包

```powershell
cd 'D:\Code\壳隐\HandPulse\app'
npm run tauri build
# 产物：
# src-tauri/target/release/bundle/nsis/HandPulse_0.9.0_x64-setup.exe
# src-tauri/target/release/bundle/msi/HandPulse_0.9.0_x64_en-US.msi
```

## 开发

```powershell
cd 'D:\Code\壳隐\HandPulse\app'
npm install
npm run dev        # 浏览器预览 http://localhost:1420/#/keyboard
npm run tauri dev  # 原生窗口（首次 cargo 编译 1–2 分钟）
```

## 构建检查

```powershell
npm run build                 # tsc + vite build
cd src-tauri; cargo check     # Rust 壳编译检查
```

## 目录结构

```
app/
├─ index.html                  # <div id="root"> + /src/main.tsx
├─ src/
│  ├─ main.tsx                 # React 挂载
│  ├─ App.tsx                  # 应用外壳、路由、全局弹层
│  ├─ app/                     # router / store
│  ├─ shell/                   # Rail / Transport / LiveTape / Inspector / TitleBar
│  ├─ pages/                   # 键盘 / 鼠标 / 数据 / 设置
│  ├─ keyboard/ mouse/ charts/ # 页面内组件（手写 SVG，不引图表库）
│  ├─ ui/                      # Modal / Toast / Segmented / Switch
│  ├─ ipc/                     # types / client / live（mock 回退）
│  ├─ state/                   # liveStore（帧去重 + rAF 批量）
│  ├─ mock/                    # 原型 mock 数据与 104 键位坐标
│  ├─ assets/fonts/            # Inter / JetBrains Mono（本地 woff2）
│  └─ styles/                  # tokens / base / shell / titlebar / 各页面样式
└─ src-tauri/                  # Tauri 2 壳（窗口 1440×900，最小 1100×720，decorations:false）
```

## 数据边界（M3）

- `src/ipc/types.ts`：与 Rust 命令一一对应的 camelCase 类型（`Summary` / `KeyStat` / `Bucket` /
  `Histogram` / `Heatmap` / `DetailRow` / `LiveFrame` / `CaptureStats` / `Settings` 等）。
- `src/ipc/client.ts`：Tauri 下历史命令直接 `invoke`；浏览器 dev 回退 mock。`getDetailPage` 使用
  Rust 返回的 `total/page/pageSize`，不再用 mock 估算总数。
- `src/ipc/live.ts`：Tauri 下 `new Channel<LiveFrame>()` + `subscribe_live`，附 2s 心跳看门狗；
  浏览器 dev 仍走 100ms mock ticker。
- `src/state/usePageData.ts`：缓存 key 带 `dataVersion`；App 每 1s 轮询 `get_data_version` 并递增
  本地 generation，让「今日」查询能把尚未关闭的当前桶也算进去。
- `src/state/useLiveOverlay.ts`：历史数据返回时记录 `liveStore` 的 seq 作为基线，之后每个实时帧的
  按键/点击/滚轮/移动/网格增量直接叠加到 UI；下一次历史查询回来时重置基线，避免重复计数。
  因此键盘/鼠标页的计数是**推模式、按下即变**，1s 轮询只做与 DB 的校准。
- Rust：`capture/windows_raw.rs` → `capture/aggregator.rs` → `storage::writer`（SQLite），
  `commands/history.rs` 提供查询；`storage/query.rs` 优先读预聚合表。

## 存储（M3）

- 数据库：`%APPDATA%\com.handpulse.desktop\data.db`（`app_data_dir()/data.db`）。
- SQLite：WAL + `synchronous=NORMAL` + `busy_timeout=5000`；写线程独占写连接，读命令每次开
  `query_only` 连接，查询走 `tauri::async_runtime::spawn_blocking`。
- 表：`bucket`（ts/granularity/device/actions/zstd(payload)）、`key_def`、`pad_bucket`、`meta`、
  `agg_hour`、`agg_day`、`key_day`、`grid_day`、`gap_day`，以及为避免 30 天查询解 4 万+ payload
  而增加的 `agg_mouse_day`（鼠标左右中侧/滚轮/峰值日聚合）。
- payload 只存聚合计数：键盘 `k/hold_sum/hold_max/chord/gap/streak_ms`，鼠标
  `cl/wh/px/cm/vmax/fast/grid`；不含按键顺序、窗口标题、输入内容。
- 桶按本地时区对齐，粒度 10/30/60 秒（设置页可改）；桶关闭时由 writer 在单事务里写 bucket +
  预聚合 + `data_version`。强杀最多丢 1 个未关闭桶；正常退出会 flush 当前桶。
- 保留期 7/30/90 天：启动时、writer 每小时检查并清理；`clear_all_data` 事务删除历史表并
  `VACUUM`，保留 `key_def`/`meta`。
- 距离换算：`cm = px * 2.54 / 96`（固定 96 DPI 估算，非物理精确值）；峰值速度按 100ms 窗口统计，
  API 返回 m/s。
- 鼠标网格分点击图层（`grid_day`）和移动图层（`move_grid_day`）；移动图层每 50ms 采样一次光标
  位置，不再用点击热力近似。侧键（前进/后退）正常采集计数，但页面层会拦截 WebView 的前进/后退导航。
- 应用内没有右键菜单：WebView 的 `contextmenu` 已屏蔽；鼠标侧键的导航也在页面层拦截，不影响计数。
- 查询口径：`session` 只读内存；`today/week/month` = DB 已关闭桶 + 当前未关闭桶（只加一次）。
  明细分页由 SQL 返回 `total`。

## 数据边界（M2 实时层）

- `src/state/liveStore.ts`：按 `seq` 去重、增量累加、`requestAnimationFrame` 批量 flush，
  `document.hidden` 时暂停 UI flush，`restart()` 重置 seq 水位。
- Rust：`commands/capture.rs`（Channel / 暂停 / 状态 / 会话命令）；`capture/keymap.rs` 的 keyId
  与前端 `HP.keyboard.keys` 顺序逐项对齐（`keymap/frontend-labels.json` fixture + 单测）。

## 采集边界（Windows）

- Raw Input 是旁路监听：不 hook、不注入、不截图、不读取输入内容，也不联网。
- 不默认提权。若前台是管理员权限的游戏（UIPI 更高完整性级别），低权限进程可能收不到输入；
  这种情况会在设置页采集状态里体现为事件停滞，需要时再评估按需提权。
- 屏幕网格只统计主屏，按 `GetSystemMetrics(SM_CXSCREEN/SM_CYSCREEN)` 归一化到 32×18；
  多显示器与 DPI 缩放暂不在 M2 覆盖范围。
- 绝对坐标鼠标（RDP / 绘图板 / `MOUSE_MOVE_ABSOLUTE` / `MOUSE_VIRTUAL_DESKTOP`）的移动包
  不当增量使用，跳过并计入 `absoluteSkipped`；普通相对鼠标行为不变。
- **Pause 键暂不支持**：Raw Input 的 E1 1D 45 特殊序列没有映射（keymap 里保留标签仅为 id 对齐），
  按下会计入 `unmapped`，不会 panic 或误计 NumLock；后续版本再实现。
- `reset_session` 同时清空会话计数与进程事件统计（events / keyEvents / mouseEvents / unmapped /
  absoluteSkipped / dropped / 延迟样本 / 秒环 / 桶），保留运行状态与单调递增的 seq。

## 视觉基准

四页截图：`screenshots/m0-web-*.png`（M0 基线）、`screenshots/m1-web-*.png`（M1 对照）、
`screenshots/m2-keyboard.png` / `m2-tauri.png`（M2 实时层）、`screenshots/m3-stats.png` /
`m3-settings.png`（M3 真实数据）、`screenshots/demo-titlebar-keyboard.png` /
`demo-stats-calendar.png`（demo 收尾：自绘标题栏 + 周标签/日历读数）。设计稿与验收基准在仓库根
`design-demos/`，本工程不修改它们。

## 窗口与标题栏

- `tauri.conf.json`：`decorations:false`，标题栏由 `src/shell/TitleBar.tsx` 自绘。
- 权限：`core:window:default` + close/minimize/toggle-maximize/start-dragging/is-maximized/
  start-resize-dragging。
- 标题栏高 38px，`.app` 为 `calc(100vh - var(--titlebar-h))`；拖动空白区移动，双击切换最大化，
  按钮不触发拖动；关闭走 Tauri `close()`，触发采集层正常 flush 后退出。
- 窗口/任务栏图标与标题栏同款三柱标记：`src-tauri/icons/` 已替换全套 PNG/ICO，启动时再用
  `window.set_icon()` 显式设置窗口图标。
- 无原生 Snap Layouts 菜单（自绘标题栏限制，见上）。

