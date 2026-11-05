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
| M4+ | CSV/JSON 导出、托盘/自启/单实例/打包签名 | 未开始 |

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
│  ├─ shell/                   # Rail / Transport / LiveTape / Inspector
│  ├─ pages/                   # 键盘 / 鼠标 / 数据 / 设置
│  ├─ keyboard/ mouse/ charts/ # 页面内组件（手写 SVG，不引图表库）
│  ├─ ui/                      # Modal / Toast / Segmented / Switch
│  ├─ ipc/                     # types / client / live（mock 回退）
│  ├─ state/                   # liveStore（帧去重 + rAF 批量）
│  ├─ mock/                    # 原型 mock 数据与 104 键位坐标
│  ├─ assets/fonts/            # Inter / JetBrains Mono（本地 woff2）
│  └─ styles/                  # tokens / base / shell / 各页面样式
└─ src-tauri/                  # Tauri 2 壳（窗口 1440×900，最小 1100×720）
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
- 距离换算：`cm = px * 2.54 / 96`（固定 96 DPI 估算，非物理精确值）。
- 移动图层：M3 暂用点击网格近似；单独的移动采样网格留待后续版本。
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
`m3-settings.png`（M3 真实数据）。设计稿与验收基准在仓库根 `design-demos/`，本工程不修改它们。
