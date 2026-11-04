# M0 开发 Prompt（复制给新对话）

> 用途：在新对话里让一个没有上下文的开发 agent，把现有原型原样跑进 Tauri 2 原生窗口。
> 对应指南：`docs/03-Tauri落地指南.md` 第 2 节路线 A。

---

# 任务：把 HandPulse 原型跑进 Tauri 2 原生窗口（只做 M0）

## 你的身份与项目

你是 HandPulse（手脉）项目的开发工程师。工作目录：`D:\Code\壳隐\HandPulse`（Windows，路径含中文，命令里要加引号）。
手脉是一个 Windows 桌面常驻应用：只记录键盘 / 鼠标的**物理键位次数、按住时长、点击、滚轮、移动距离和屏幕网格命中**，不记录输入内容、窗口标题、不截屏、不联网。目标是给玩家看“我的手在怎么用力”，不做健康评分、不做建议、不做提醒。

现在 UI 原型已经定稿，是一个单文件 HTML：`design-demos/HandPulse-Prototype.html`。你的任务不是重做设计，而是把它**原样装进 Tauri 2 的原生窗口**，让它在 WebView2 里跑起来。这是 M0，数据仍然是 mock，不接真实采集。

**先读文档，再动手。不要凭印象改设计，不要问用户“要不要 React”，路线已经定了。**

## 必读（按顺序，读完再开始）

1. `docs/03-Tauri落地指南.md` 第 2 节「路线 A」、第 3 节「Tauri 壳配置」、第 4 节「前端迁移」。这是本次任务的施工图。
2. `design-demos/HandPulse-Prototype.html`：**视觉与交互的唯一基准**。单文件，包含全部 CSS、内联 mock 数据、base64 字体、四页 hash 路由和应用脚本。请完整读一遍结构（`<style>`、`<body>`、两个 `<script>`），不要只看开头。
3. `design-demos/shots/final-keyboard.png`、`final-mouse.png`、`final-stats.png`、`final-settings.png`：验收时要对齐的截图。
4. `docs/02-原型需求报告.md`：第 0、3.1、4、5.1–5.4、7.2、9.1 节。理解四页各自的内容、状态和 P0 验收点。
5. `README.md`、`spec.md`、`direction-approved.md`：当前交付状态、数据口径、设计选择。

**这些文件只读，不要修改**：`design-demos/`（包括原型和截图）、`docs/`、`directions.md`、`spec.md`、`direction-approved.md`、`README.md`。你的工作产物全部放在新的 `app/` 目录里。

## 当前环境（已确认，不要重复猜）

- Windows，路径 `D:\Code\壳隐\HandPulse`。
- Rust 1.96.0、cargo 1.96.0；Node 26.13.0；npm 可用；**pnpm 未安装，用 npm**。
- WebView2 Runtime 156.0.4314.58 已安装。
- Tauri 稳定线是 2.x（crates.io `tauri` 2.12.5）；用 `npm create tauri-app@latest` 生成的模板版本即可，不要手动降级/升级。
- 本机可能没有全局 Playwright；截图用工作区已有的 `tools/shot.cjs`（它 require 了 skill 里的 playwright），或直接用 DSH 的浏览器工具。

## 目标（M0 的定义）

在 `app/` 下生成一个 Tauri 2 工程，运行 `npm run tauri dev` 后打开原生窗口，窗口里显示的就是现有原型：

- 窗口 1440×900，最小 1100×720，深色，黑色背景，标题「手脉 HandPulse」。
- 四页 hash 路由照旧：`#/keyboard`、`#/mouse`、`#/stats`、`#/settings`。
- 键盘热力、实时高亮、Top10、鼠标网格、鼠标 SVG、折线/直方/热力、明细表、设置开关、清空确认，全部和原型一致。
- 数据仍是 mock；不接 Rust 采集，不写 SQLite，不做托盘/自启/打包安装包。
- 浏览器 `npm run dev` 也能打开同一页面，方便截图和调样式。

## 路线（必须按这条走）

用 **vanilla-ts** 模板，把原型原样搬进 Vite，不做 React 组件化。React 迁移是 M1 的事，这次不要做。

## 步骤

### 1. 先确认现状与工具链

```powershell
cd 'D:\Code\壳隐\HandPulse'
Get-ChildItem
cargo --version
node --version
npm --version
Test-Path 'design-demos\HandPulse-Prototype.html'
```

如果 `cargo` / `node` / `npm` 缺失，停下来报告，不要自己装一堆东西。

### 2. 生成 Tauri 工程

```powershell
cd 'D:\Code\壳隐\HandPulse'
npm create tauri-app@latest app
```

交互选择：

- package manager: `npm`
- UI template: `Vanilla`
- UI flavor: `TypeScript`

如果交互式命令在非 TTY 下无法选择，先看 `npm create tauri-app@latest -- --help`，用等价的非交互参数；把实际命令写进报告。

```powershell
cd 'D:\Code\壳隐\HandPulse\app'
npm install
```

### 3. 改 Tauri 配置

编辑 `app/src-tauri/tauri.conf.json`，至少包含：

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

注意：模板里已有的 `build` 字段和 `identifier` 以模板为准，不要覆盖成不存在的路径；只改窗口、标题、背景、CSP。若模板对 `theme` / `backgroundColor` 的 schema 版本不支持，按实际 schema 调整并记录。

`app/src-tauri/capabilities/default.json` 保持最小权限：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "HandPulse main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

### 4. 把原型搬进 Vite

1. 备份/保留原型不动。目标文件：
   - `app/index.html`
   - `app/src/styles/prototype.css`
   - `app/src/legacy/mock.ts`（原型的 mock `<script>`，含 `window.HP = ...`）
   - `app/src/legacy/app.ts`（原型的应用 `<script>`，文件头加 `// @ts-nocheck`）
   - `app/src/main.ts`（只负责 `import './styles/prototype.css'; import './legacy/mock'; import './legacy/app';`）
2. `app/index.html`：
   - 删除 Vite 模板的示例 DOM（`<div id="app"></div>` 里的计数器等内容），但**保留 `<div class="app" id="app">` 这个原型根节点**（原型的整个 `<body>` 内容替换进来）。
   - 保留 `<script type="module" src="/src/main.ts"></script>` 放在 `</body>` 前。
   - `<title>` 改成「手脉 HandPulse」。
   - `<html lang="zh-CN">`、`<body>` 的 `data-route` 初始值按原型保留。
3. `<style>` 原样复制到 `prototype.css`。字体 base64 先保留，不要在这一步抽文件。
4. 原型的两个 `<script>` 按顺序拆到 `legacy/mock.ts` 和 `legacy/app.ts`；应用脚本如果直接使用全局 `HP`，在 `app.ts` 顶部加：
   ```ts
   // @ts-nocheck
   const HP = (window as any).HP;
   ```
   两个文件都保留 IIFE / 原有执行顺序；不要重写逻辑。
5. 原型的脚本如果在模块里拿不到 `window.HP`，检查导入顺序：`main.ts` 先 import mock，再 import app。
6. 不要用 iframe 嵌原型；必须是实际的 DOM 和脚本。
7. 不要改任何视觉 token、字号、颜色、间距、键盘坐标、图表逻辑、文案。M0 只换外壳。

### 5. 跑起来

```powershell
cd 'D:\Code\壳隐\HandPulse\app'
npm run dev
```

先在浏览器打开 `http://localhost:1420/#/keyboard`，确认四页正常、控制台 0 error、字体加载。然后：

```powershell
npm run tauri dev
```

首次 `cargo` 编译会下载依赖，可能 3–10 分钟；不要中途杀掉，等它完成。如果失败，贴完整错误再处理。

### 6. 验证（必须做，不能只看“命令没报错”）

1. **浏览器截图**（四页，1440×900）：
   ```powershell
   cd 'D:\Code\壳隐\HandPulse'
   New-Item -ItemType Directory -Force 'app\screenshots' | Out-Null
   node tools\shot.cjs 'http://localhost:1420/#/keyboard' 'app\screenshots\m0-web-keyboard.png' 1440 900 --wait=1500
   node tools\shot.cjs 'http://localhost:1420/#/mouse'    'app\screenshots\m0-web-mouse.png'    1440 900 --wait=1200
   node tools\shot.cjs 'http://localhost:1420/#/stats'    'app\screenshots\m0-web-stats.png'    1440 900 --wait=1200
   node tools\shot.cjs 'http://localhost:1420/#/settings' 'app\screenshots\m0-web-settings.png' 1440 900 --wait=1200
   node tools\shot.cjs 'http://localhost:1420/#/keyboard' 'app\screenshots\m0-web-1100.png'     1100 900 --wait=1200
   ```
   如果 `tools/shot.cjs` 因 Playwright 路径失败，改用 DSH 浏览器工具访问同一 URL 截图；不要跳过。
2. **原生窗口截图**：确保 `npm run tauri dev` 的窗口已打开并置前：
   ```powershell
   (New-Object -ComObject WScript.Shell).AppActivate('手脉 HandPulse') | Out-Null
   Start-Sleep -Milliseconds 800
   Add-Type -AssemblyName System.Windows.Forms,System.Drawing
   $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
   $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
   $g=[System.Drawing.Graphics]::FromImage($bmp)
   $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)
   $bmp.Save('D:\Code\壳隐\HandPulse\app\screenshots\m0-tauri.png')
   $g.Dispose(); $bmp.Dispose()
   ```
   必须有一张 Tauri 原生窗口的截图；只有浏览器截图不算完成。
3. **构建检查**：
   ```powershell
   npm run build
   cd src-tauri
   cargo check
   ```
4. **控制台**：浏览器 dev 和 Tauri 窗口的 console 都不能有 error。Tauri 窗口的报错看 `npm run tauri dev` 终端输出和 WebView 控制台；如果有，修掉。
5. **尺寸**：1440 和 1100 宽都不能横向滚动；1100 宽 inspector 隐藏是允许的（原型已有该断点）。

### 7. 验收清单

- [ ] `app/` 是 Tauri 2 工程，`npm run tauri dev` 能打开原生窗口。
- [ ] 窗口 1440×900，最小 1100×720，黑色背景，标题「手脉 HandPulse」。
- [ ] 四页路由都能点，键盘 / 鼠标 / 数据 / 设置与 `final-*.png` 视觉一致。
- [ ] 键盘 104/87、显示模式、范围、Top10、键详情、暂停；鼠标图层、网格、SVG；图表 tab；设置开关与清空确认；全部可交互。
- [ ] 浏览器 dev 与 Tauri 窗口控制台 0 error。
- [ ] 1440 / 1100 无横向滚动。
- [ ] `npm run build` 与 `cargo check` 通过。
- [ ] 截图：`app/screenshots/m0-web-*.png`、`m0-tauri.png`。

## 非目标（这次不要做）

- 不写 Rust 采集（Raw Input）、不接 SQLite、不做真实 IPC 命令。
- 不做 React 组件化、不拆 charts、不换 Tailwind / ECharts。
- 不做托盘、自启、单实例、打包安装包、签名。
- 不改设计、不改文案、不“顺手优化”视觉；原型就是验收标准。
- 不引入任何外部 CDN、在线字体、网络请求；不加不必要依赖。

## 规则

- 所有命令用 PowerShell；路径含中文，必须加引号。
- 不要修改 `design-demos/`、`docs/`、`README.md`、`spec.md`、`direction-approved.md`、`directions.md`。
- 不要用 `pnpm`；没有装。
- 不要用 iframe、不要重定向到另一个页面、不要用 `dangerouslySetInnerHTML` 做 React 组件化（这次是 vanilla）。
- 遇到报错：先读完整错误、最小化复现、查 Tauri 2 文档；不要靠猜改配置。Tauri 文档：https://v2.tauri.app/reference/config/ 。
- 如果你改了模板默认的端口，`tauri.conf.json` 的 `devUrl` 必须同步。
- 不要声称“完成”而没有跑过 `npm run tauri dev` 和截图。失败就如实报告。

## 最终报告（简短）

1. 你实际执行了哪些命令；生成的 `app/` 结构。
2. 关键改动：`tauri.conf.json`、`capabilities/default.json`、`index.html`、`src/main.ts`、`src/legacy/*`。
3. 截图路径：四页 web + 1100 + `m0-tauri.png`。
4. 验证结果：`npm run build`、`cargo check`、控制台错误数、窗口尺寸。
5. 没做完 / 有偏差的地方（诚实写）。
