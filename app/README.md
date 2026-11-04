# 手脉 HandPulse · app

Windows 桌面常驻应用「手脉」的 Tauri 2 工程。界面沿用已定稿原型（`../design-demos/HandPulse-Prototype.html`），
当前阶段数据全部为 mock；不联网、不读取输入内容。

## 状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | Tauri 2 壳 + 原型原样迁移（vanilla-ts） | 已完成 |
| M1 | React/TS 组件化、字体与样式拆分、类型化 IPC 边界 + live store（仍 mock） | 已完成 |
| M2 | Windows Raw Input + Aggregator + `Channel<LiveFrame>` 实时层（历史仍 mock） | 本阶段 |
| M3+ | SQLite 落盘、真实历史查询、托盘/自启/打包 | 未开始 |

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

## 数据边界（M1 / M2）

- `src/ipc/types.ts`：与 Rust 命令一一对应的 camelCase 类型（`Summary` / `KeyStat` / `Bucket` /
  `Histogram` / `Heatmap` / `DetailRow` / `LiveFrame` / `CaptureStats` / `SessionSummary`）。
- `src/ipc/client.ts`：`invoke` 封装 + `isTauri` 判断 + `IPC_READY` 开关。历史数据命令仍是 mock
  （`IPC_READY = false`）；M2 只让实时层走真实 Channel。
- `src/ipc/live.ts`：Tauri 下 `new Channel<LiveFrame>()` + `subscribe_live`，附 2s 心跳看门狗，
  断流时自动重建订阅；浏览器 dev 仍走 100ms mock ticker。
- `src/state/liveStore.ts`：按 `seq` 去重、增量累加、`requestAnimationFrame` 批量 flush，
  `document.hidden` 时暂停 UI flush，`restart()` 重置 seq 水位。
- Rust：`capture/windows_raw.rs`（Raw Input 线程）→ `capture/aggregator.rs`（单线程计数）→
  `commands/capture.rs`（Channel / 暂停 / 状态 / 会话命令）；`capture/keymap.rs` 的 keyId
  与前端 `HP.keyboard.keys` 顺序逐项对齐（`keymap/frontend-labels.json` fixture + 单测）。

## 采集边界（Windows）

- Raw Input 是旁路监听：不 hook、不注入、不截图、不读取输入内容，也不联网。
- 不默认提权。若前台是管理员权限的游戏（UIPI 更高完整性级别），低权限进程可能收不到输入；
  这种情况会在设置页采集状态里体现为事件停滞，需要时再评估按需提权。
- 屏幕网格只统计主屏，按 `GetSystemMetrics(SM_CXSCREEN/SM_CYSCREEN)` 归一化到 32×18；
  多显示器与 DPI 缩放暂不在 M2 覆盖范围。
- Pause 的 E1 特殊序列暂不映射，会计入 `unmapped`，不会 panic 或误计其他键。

## 视觉基准

四页截图：`screenshots/m0-web-*.png`（M0 基线）、`screenshots/m1-web-*.png`（M1 对照）、
`screenshots/m2-keyboard.png` / `m2-tauri.png`（M2 实时层，原生窗口只截窗口区域）。
设计稿与验收基准在仓库根 `design-demos/`，本工程不修改它们。
