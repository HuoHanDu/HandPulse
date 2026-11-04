# 手脉 HandPulse · app

Windows 桌面常驻应用「手脉」的 Tauri 2 工程。界面沿用已定稿原型（`../design-demos/HandPulse-Prototype.html`），
当前阶段数据全部为 mock；不联网、不读取输入内容。

## 状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | Tauri 2 壳 + 原型原样迁移（vanilla-ts） | 已完成 |
| M1 | React/TS 组件化、字体与样式拆分、类型化 IPC 边界 + live store（仍 mock） | 本阶段 |
| M2+ | Raw Input 采集、SQLite、真实 IPC、托盘/自启/打包 | 未开始 |

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

## 视觉基准

四页截图：`screenshots/m0-web-*.png`（M0 基线）、`screenshots/m1-web-*.png`（M1 对照）。
设计稿与验收基准在仓库根 `design-demos/`，本工程不修改它们。
