# M2 开发 Prompt（复制给新对话）

> 前置：M0（Tauri 壳 + 原型）、M1（React/TS 组件化 + 字体/样式拆分 + 类型化 IPC 边界）已完成，git 干净。
> 本次先修 M1 的 2 个功能 bug，再做 M2：Windows Raw Input 采集 + 聚合 + 实时 Channel。**不写 SQLite**（M3）。

---

# 任务：HandPulse M2 — 修掉 M1 遗留，接入 Windows Raw Input 与实时 Channel

## 0. 身份与当前状态

你是 HandPulse（手脉）项目的开发工程师。工作目录：`D:\Code\壳隐\HandPulse`（Windows，路径含中文，命令加引号）。

M1 已完成：

- `app/` 是 React 19 + TypeScript + Vite 8 + Tauri 2 工程；窗口 1440×900、min 1100×720。
- 样式已拆到 `app/src/styles/`，字体在 `app/src/assets/fonts/`，CSS 从 566 KB 降到 33 KB。
- `app/src/ipc/types.ts` 定义了 `Summary / KeyStat / Bucket / Histogram / Heatmap / DetailPage / LiveFrame`。
- `app/src/ipc/client.ts`：`IPC_READY = false`，历史数据仍走 mock；浏览器与 Tauri 都回退 mock。
- `app/src/ipc/live.ts`：`startLive()` 仍是 100 ms mock ticker；`liveStore` 已做 seq 去重 + rAF 批量 + hidden 暂停。
- `app/src/keyboard/KeyboardCanvas.tsx`：104/87 键位 DOM 只建一次，热力/范围只改样式，实时帧只给脏键 `.flash`。
- 四页截图 `app/screenshots/m1-web-*.png`、原生窗口 `m1-tauri.png`（已裁成窗口，不含桌面其他内容）。
- `npm run build`、`cargo check` 通过；Vite dev 四路由 0 console error；1440/1100 无横向滚动。
- git 历史：M0 baseline + 5 个 M1 commit；工作区干净。

### M1 代码审查已发现的问题（本次阶段 0 必须修）

1. **设置页的「桶粒度」「数据保留」分段按钮是死的**：`SettingsPage.tsx` 里 `#granSeg` / `#keepSeg` 的按钮没有 `onClick`，`store.ts` 也没有 `setGranularity` / `setRetention` action。实测点击前后 `aria-pressed` 都不变。必须让它们真的改 `state.granularity` / `state.retention`，并让右侧 inspector 的「写入粒度 / 保留」同步。
2. **明细表只显示 8 行**：`charts/DetailTable.tsx` 里 `.slice(0, 8)`，但 `DetailPage.pageSize = 50`，分页显示「共 1,304 行，每页 50 行」。需求是每页 50 行。改成 50 行 + 表格内部滚动（`.tablewrap` 固定高度/滚动），不要靠 8 行糊弄。
3. **四页导语是硬编码 mock 数字**：`KeyboardPage` / `MousePage` / `StatsPage` 的 `g-head p` 写死了「12,438 / W 1,204 / 5,204 / 12.4 公里 / 380 APM」。切换范围到 7 天/30 天就会说错。用当前 `data` 动态生成；没有数据时用空态文案。
4. **LiveTape 仍是 mock 发生器**：`shell/LiveTape.tsx` 自己用 `HP` + 伪随机画带，没有订阅 `liveStore`。M2 接真实帧后，必须改成消费 `liveStore` 的增量（浏览器 mock 也走同一条路），否则时间轴是假的。
5. **MouseSvg 随机闪一个键**：`mouse/MouseSvg.tsx` 用 `Math.random()` 选 `FLASH_IDS`，没有看 `deltas.clicks`。M2 的 `LiveFrame.clicks` 是 `[left,right,middle,side1,side2]`，要按真实索引点闪对应按键/滚轮。
6. **`usePageData` 缓存没有失效机制、没有错误态**：range 切换靠 key 换没问题，但 clear/restore、M2 实时数据、M3 新桶都不会刷新；`loader()` rejection 没有 catch。至少加 `clearPageDataCache()` 并在 clear/restore 时调用；加 `error` 状态（页面可显示空态/错误文案）。M2 不接历史真数据，但边界要留好。
7. **`liveStore.reset()` 不重置 `lastSeq`**：如果 M2 的 seq 从 0 重新开始，reset 后所有帧会被当旧帧丢掉。加 `start(seqBase = -1)` / reset seq；`startLive` 启动时调用。
8. **`App.tsx` 的 startLive cleanup 有竞态**：Promise resolve 晚于 unmount 时 interval 不会被清。改成 `startLive().then(fn => { alive ? stop = fn : fn(); })` 或在 cleanup 里处理。
9. （可选，顺手）`Inspector` 的统计页「峰值 / 峰值时刻」直接读 mock `HP`，M2 历史仍是 mock 可接受，但建议改成读 `stats?.line.peak`，为 M3 铺路。

先做这些修复并单独提交：`fix(m1): settings segments, detail rows, dynamic headers`。

## 必读

1. `docs/03-Tauri落地指南.md` 第 5 节「Rust 采集层」、第 6 节前半（边界，不写 SQLite）。
2. `docs/02-原型需求报告.md` 第 5.2–5.4、6.1、8、9.2 节：键鼠字段、桶、性能、验收。
3. `app/src/ipc/types.ts`、`app/src/ipc/live.ts`、`app/src/state/liveStore.ts`、`app/src/mock/mock.ts`、`app/src/keyboard/layout.ts`。
4. `app/src/keyboard/KeyboardCanvas.tsx`、`app/src/mouse/MouseSvg.tsx`、`app/src/shell/LiveTape.tsx`、`app/src/shell/Inspector.tsx`。
5. M1 的 `screenshots/m1-web-*.png`：视觉不能变。

只读：`design-demos/`、`docs/`、根 `README.md` / `spec.md` / `direction-approved.md` / `directions.md`。只改 `app/`。

## 环境

- Windows 10/11；Rust 1.96、cargo；Node 26、npm；WebView2 156；Tauri 2.12.x。
- 不用 pnpm；不引外部 CDN；不联网。
- 本次只做 Windows 采集；用 `#[cfg(windows)]` 隔离，非 Windows 编译返回“不支持”。

---

## 阶段 0：M1 修复（先提交）

按上面的 1–9 条改。要求：

- `SettingsPage` 用 `Segmented` 或直接 `onClick`，真正 dispatch `setGranularity` / `setRetention`；`Inspector` 的 `state.granularity` / `state.retention` 随之变化。
- `DetailTable` 50 行 + 内部滚动；分页数字与行数一致。
- 导语用数据动态拼；不要写死 mock 数字。
- `LiveTape` 改为订阅 `liveStore`；浏览器 mock 继续有画面。
- `MouseSvg` 按 `clicks` 索引闪对应部件。
- `usePageData` 加 `clearPageDataCache()`；clear/restore 时调用；加 error 状态。
- `liveStore` 增加 `restart()` / reset seq；`startLive` 调用；修 cleanup 竞态。

提交：`fix(m1): settings segments, detail rows, dynamic headers`

---

## 阶段 1：M2 架构

```
Raw Input 线程（消息专用窗口）
   │ RawEvent（小结构、Copy）
   ▼
Aggregator 线程（pressed 集合、计数、按住、组合键、滚轮、位移、网格）
   │ 100 ms 增量                  │ 1 s 环 / 60 s 内存桶（M3 落盘）
   ▼                              ▼
Channel<LiveFrame> ──► 前端 liveStore ──► 键盘/鼠标/时间轴
   ▲
Commands: subscribe_live / unsubscribe_live / set_paused /
          get_capture_stats / get_session_summary / reset_session
```

线程原则：

- Raw Input 线程只解析 + 发送，不碰磁盘、不碰 UI。
- Aggregator 线程单线程持有全部可变状态，避免锁竞争。
- Channel 发送失败就清掉订阅，不要让采集线程崩。
- 暂停时停止计数与发帧；恢复时清空 pressed 集合，避免“卡住的键”。
- 退出时进程结束即可，不要求优雅 join；但不要阻塞 Tauri 退出。

### 依赖

```toml
# app/src-tauri/Cargo.toml
[dependencies]
# 保留现有 tauri/serde/serde_json
crossbeam-channel = "0.5"
parking_lot = "0.12"
thiserror = "2"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.62", features = [
  "Win32_Foundation",
  "Win32_UI_Input",
  "Win32_UI_WindowsAndMessaging",
  "Win32_UI_HiDpi",
] }
```

---

## 阶段 2：Keymap（先于 Raw Input）

**keyId 的唯一标准是前端 `app/src/mock/mock.ts` 里 `HP.keyboard.keys` 的数组顺序（0–103）。** 任何重排都会让实时高亮打到错误的键。

1. 建 `app/src-tauri/keymap/qwerty-104.json`，数组每项：
   ```json
   { "id": 0, "label": "Esc", "scan": 1, "extended": false }
   ```
   - `label` 必须与前端 `HP.keyboard.keys` 的 label 完全一致（包括 `\``、`-`、`=`、`[`、`]`、`\\`、`;`、`'`、`,`、`.`、`/`、`N0`…`N9` 等）。
   - `scan` 用 `RAWKEYBOARD.MakeCode`（扫描码），不要用 VKey；`extended` 对应 `RI_KEY_E0`。
   - 覆盖 104 键；F1–F12、PrtSc/ScrLk/Pause、Ins/Home/PgUp、Del/End/PgDn、方向键、小键盘都要有。
2. `capture/keymap.rs`：`include_str!` 解析为 `Vec<KeyDef>`；建立 `scan|extended -> keyId` 查找表。
3. **测试**：`cargo test keymap` 校验：
   - 数组长度 104；
   - id 连续 0..103；
   - label 序列与 `mock.ts` 的 `HP.keyboard.keys.map(k => k.label)` 完全一致（把这一列写在测试里或导出 fixture，不要靠肉眼）；
   - 无重复 scan（同一 scan 不同 extended 可以）；
   - 未映射键在 stats 里计入 `unmapped`，不 panic。

扫描码参考：Microsoft Keyboard Scan Code Specification；字母/数字/符号按主键区，方向键/右 Ctrl/右 Alt/小键盘 Enter/斜杠等注意 E0 前缀；Pause 的 E1 特殊序列可以暂时记为 unmapped，但要在 stats 里可见。

---

## 阶段 3：Raw Input

`capture/windows_raw.rs`，仅 Windows：

1. 在专用线程创建 message-only window：`CreateWindowExW(..., HWND_MESSAGE, ...)`，类名用 `STATIC`。
2. `RegisterRawInputDevices` 注册：
   ```rust
   RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x06, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd } // keyboard
   RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd } // mouse
   ```
   `RIDEV_INPUTSINK` 保证后台/无焦点也能收到；`hwndTarget` 必须是有效窗口。
3. 消息循环 `GetMessageW`；`WM_INPUT` 时 `GetRawInputData` 取 `RAWINPUT`：
   - `RIM_TYPEKEYBOARD`：`MakeCode`、`Flags`（`RI_KEY_BREAK` / `RI_KEY_E0` / `RI_KEY_E1`）、`VKey`（只做日志，不用于映射）。
   - `RIM_TYPEMOUSE`：`usButtonFlags`（`RI_MOUSE_LEFT_BUTTON_DOWN/UP` 等）、`usButtonData`（滚轮，`i16`）、`lLastX/lLastY`。
4. 组 `RawEvent` 发给 aggregator：
   ```rust
   enum RawEvent {
     Key { key_id: Option<u16>, down: bool, at: Instant, unmapped: Option<u16> },
     Button { btn: MouseBtn, down: bool, at: Instant },
     Wheel { delta: i16, at: Instant },
     Move { dx: i32, dy: i32, at: Instant },
   }
   ```
   鼠标点击的屏幕网格在 aggregator 里用 `GetCursorPos` + `GetSystemMetrics(SM_CXSCREEN/SM_CYSCREEN)` 归一化到 32×18；只统计主屏（文档里注明）。
5. 失败（窗口/注册）写到 `CaptureStats.error`，Tauri 仍然能启动，UI 显示“采集不可用”，不要 panic 整个应用。
6. 管理员/UIPI：Raw Input 是旁路监听，但前台是更高完整性级别的游戏时可能收不到输入。**不要默认提权**；在 README/设置说明这个边界，遇到再评估。
7. 反作弊：只读 Raw Input，不 hook、不注入、不截图。

注意：`windows` crate 0.62 的函数签名可能和示例不同，以编译器为准；不要凭记忆硬写。

---

## 阶段 4：Aggregator

`capture/aggregator.rs`，单线程状态机：

- 状态：
  ```rust
  pressed: HashMap<u16, Instant>,     // keyId -> 按下时刻
  counts: [u64; 104],
  hold_sum: [u64; 104], hold_max: [u64; 104], hold_n: [u64; 104],
  clicks: [u64; 5],                   // left/right/middle/side1/side2
  wheel: [u64; 2], wheel_accum: i32,
  move_px: f64, peak_speed: f64,
  grid: [u32; 576],
  chords: u64,
  session_start: Instant,
  ```
- Key down：
  - 已在 `pressed` → 自动重复，忽略计数（不重置 hold 起点）。
  - 否则：`counts[key] += 1`；`pressed.insert(key, now)`；如果 pressed 非空则 `chords += 1`。
- Key up：取 `now - start` 为 hold ms；更新 sum/max/n；移除 pressed；没按下过的 up 忽略。
- 鼠标按下：clicks 对应位 +1；同时用光标位置落网格（任何按键点击都算；主屏归一化到 0..31 / 0..17，越界 clamp）。
- 滚轮：`wheel_accum += data as i16`；每满 120 记 1 格（正=上，负=下），余数保留；高精度滚轮 30/60 不会丢。
- 位移：`move_px += hypot(dx,dy)`；每 100ms 窗口算一次瞬时速度 `dist/0.1`，更新峰值；绝对模式鼠标（`MOUSE_MOVE_ABSOLUTE`）先跳过并计数。
- 暂停：`paused` 为真时丢弃事件；暂停/恢复时清空 `pressed`（避免 hold 跨暂停）。
- 会话：`reset_session()` 清 counts/clicks/wheel/move/grid/hold/pressed，保留运行状态。
- 1s 环：`VecDeque<SecondSample>` 保留最近 60 个秒样本（M3 落盘用；M2 可以只留结构）。
- 60s 桶：先做内存 `Bucket`，**不写 SQLite**；M3 再接。
- 延迟：每个 RawEvent 带 `Instant`；每帧记录 `emit_latency`（事件→帧发送）到 1024 样本环，算 p50/p95/p99。

### LiveFrame

与 `app/src/ipc/types.ts` 对齐：

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFrame {
    pub seq: u64,
    pub ts: u64,                 // epoch ms，前端 Date.now() 可近似对比
    pub keys: Vec<(u16, u32)>,   // [keyId, delta]
    pub clicks: [u32; 5],
    pub wheel: [i32; 2],
    pub dx: i32,
    pub dy: i32,
    pub grid: Vec<(u8, u8)>,
}
```

每 100ms 取一次增量发帧；没有事件时也发空帧（保持 seq/心跳），或至少每 500ms 发一次心跳；前端 `liveStore` 已能处理空帧。

---

## 阶段 5：Commands 与 Channel

`commands/capture.rs`：

```rust
#[tauri::command]
pub fn subscribe_live(channel: tauri::ipc::Channel<LiveFrame>, state: State<CaptureHandle>) -> Result<(), String>
#[tauri::command]
pub fn unsubscribe_live(state: State<CaptureHandle>) -> Result<(), String>
#[tauri::command]
pub fn set_paused(paused: bool, state: State<CaptureHandle>) -> Result<(), String>
#[tauri::command]
pub fn get_capture_stats(state: State<CaptureHandle>) -> CaptureStats
#[tauri::command]
pub fn get_session_summary(state: State<CaptureHandle>) -> SessionSummary
#[tauri::command]
pub fn reset_session(state: State<CaptureHandle>) -> Result<(), String>
```

- 用 `Channel` 而不是事件：Tauri 官方文档明确事件系统不保证低延迟/顺序，流式数据推荐 Channel。
- 只维护一个主窗口订阅：`Mutex<Option<Channel<LiveFrame>>>`；`subscribe_live` 覆盖旧的；`unsubscribe_live` 清空。Channel 发送失败就清空。
- 在 `lib.rs` 的 `.setup()` 启动 capture；用 `app.manage(CaptureHandle::new())`；`invoke_handler` 注册全部命令。
- `CaptureStats` 字段建议：
  ```rust
  running: bool, paused: bool, events: u64, key_events: u64, mouse_events: u64,
  dropped: u64, unmapped: u64, latency_p50_ms: f64, latency_p95_ms: f64,
  latency_p99_ms: f64, uptime_ms: u64, error: Option<String>
  ```
- `SessionSummary`：keys/clicks/wheel/movePx/topKeys/chords/hold 示例（至少 A 键的 holdAvg/holdMax）。
- 命令全部 `Result`，错误转 string；不要 panic。

前端类型同步：`app/src/ipc/types.ts` 增加 `CaptureStats` / `SessionSummary`；字段 camelCase。

---

## 阶段 6：前端接线

1. `src/ipc/live.ts`：
   ```ts
   import { Channel, invoke } from '@tauri-apps/api/core';
   import { isTauri } from './client';

   export async function startLive(): Promise<() => void> {
     if (!isTauri) return startMockLive(); // 保留现有 mock ticker 作为浏览器 dev
     liveStore.restart();
     const ch = new Channel<LiveFrame>();
     ch.onmessage = (f) => liveStore.push(f);
     await invoke('subscribe_live', { channel: ch });
     return async () => { try { await invoke('unsubscribe_live'); } catch {} };
   }
   ```
   `startMockLive` 就是现在的 100ms ticker，抽成独立函数。
2. `state/liveStore.ts`：加 `restart(seqBase = -1)` 重置 `lastSeq` 和 pending；`startLive` 调用。
3. 暂停：`App.tsx` 加 effect（或 `useCapturePause` hook）：
   ```ts
   useEffect(() => {
     if (isTauri) invoke('set_paused', { paused: state.paused }).catch(() => {});
   }, [state.paused]);
   ```
   浏览器 mock 时忽略。注意初始化 false 也会 invoke 一次，可接受。
4. `LiveTape`：
   - 删掉自己的 `HP` 伪随机生成；
   - `useEffect` 订阅 `liveStore`；每次 flush 计算本帧强度（keys 总数 + clicks + |wheel|），shift/push 一个 cell，`draw()`；
   - 暂停时停止 shift，但保留画面；浏览器 mock 帧同样走这条路。
5. `MouseSvg`：用 `deltas.clicks.findIndex(v => v > 0)` 映射 `mLeft/mRight/mMiddle/mSide1/mSide2`；`deltas.wheel` 非零闪 `mWheel`；不要随机。
6. `Inspector` 设置页「采集内核」区域：
   - 每 1s `invoke('get_capture_stats')`（仅 Tauri；浏览器显示“浏览器 mock”）；
   - 展示 运行/暂停、事件数、丢弃、P95/P99；可选加一个「重置本次会话」按钮调用 `reset_session`。
7. 历史数据不动：`IPC_READY` 保持 `false`；`get_summary/get_key_stats/...` 继续 mock。M2 只让**实时层**接真数据。
8. 视觉不变：不新增页面、不改色/字号/间距；新增的 stats 行只占用 inspector 已有行样式。

---

## 阶段 7：测试与验收

### 单元测试（`cargo test`）

- `keymap`：104 键、id 连续、label 与前端顺序一致、scan 无重复。
- aggregator 用合成 `RawEvent`：
  - 1000 次 keydown/keyup → counts 准确；
  - 自动重复：同一键连续 30 次 down → 只计 1 次；
  - 长按：down 5s 后 up → hold ≈ 5000ms；
  - 组合键：W+A → chords 增加；
  - 滚轮：120 / 30 / -120 的累计正确，余数不丢；
  - 暂停/恢复：paused 时事件不计数，恢复后 pressed 清空；
  - reset_session：计数归零，运行状态保留；
  - 网格：越界光标 clamp 到 32×18；
  - `unmapped` 不 panic。

### 手动/集成

- `npm run tauri dev`；用 PowerShell `SendInput`/`keybd_event` 发 100 次键，检查 `get_capture_stats` 的 `events/key_events` 增加 100；用鼠标点击/滚轮/移动验证。
- 长按 A 5 秒；自动重复（按住不放）；W+A 组合；鼠标侧键；滚轮 10 格（1200 units）。
- 暂停/恢复：暂停后输入不计数；恢复后没有卡住的 pressed。
- 延迟：在 `get_capture_stats` 里看 p50/p95/p99，目标 p99 < 30ms（G1）。如果达不到，先把发帧间隔从 100ms 调到 50ms 做对照，不要改 UI。
- CPU：400 APM（≈6.7 键/秒）+ 鼠标动作 10 分钟，任务管理器 < 1.5%。
- 浏览器 `npm run dev` 仍能用 mock ticker；Tauri 下走真 Channel。
- 四页控制台 0 error；1440 / 1100 无横向滚动；视觉与 `m1-web-*.png` 一致。
- 截图：`app/screenshots/m2-keyboard.png`、`m2-tauri.png`（只含窗口）。不需要重拍全部四页，但键盘页和 Tauri 窗口必须有。

### 验收清单

- [ ] 阶段 0 的 M1 bug 全部修掉，单独 commit。
- [ ] `cargo test` 全绿；`cargo check`、`npm run build` 通过。
- [ ] 1000 键计数准确；自动重复只计 1；长按 5s；组合键；滚轮 120/30；网格 clamp。
- [ ] 暂停/恢复正确；恢复后无 stuck key。
- [ ] Channel 实时帧驱动键盘高亮、鼠标对应按键闪光、LiveTape；浏览器 mock 仍可用。
- [ ] `get_capture_stats` 有 p50/p95/p99、dropped、unmapped；p99 < 30ms。
- [ ] 400 APM 下 CPU < 1.5%。
- [ ] 不写 SQLite、不接历史真数据；`IPC_READY` 保持 false。
- [ ] 视觉不变；git 干净；提交历史清晰。

## 非目标（本次不要做）

- 不写 SQLite / 不落盘 / 不做 30 天历史 / 不改 `get_summary` 等历史命令。
- 不做托盘、自启、单实例、导出、打包。
- 不做 macOS/Linux 采集；Windows 优先，`#[cfg]` 隔离。
- 不改设计、不改四页布局、不引 ECharts/Tailwind/状态库。
- 不做手柄；`pad_bucket` 仍预留。

## 规则

- Windows PowerShell；中文路径加引号。
- 先读后改；每次提交前 `git diff --cached --stat` 检查没有 target/node_modules/dist。
- 不要 amend 历史 commit；M1 修复单独提交。
- 采集层错误要暴露在 `CaptureStats.error`，不要让应用启动失败或静默丢数据。
- 不记录输入内容、窗口标题、剪贴板；不联网。
- 失败就如实报告；不要声称通过而没有跑 `cargo test` / `npm run tauri dev` / 手动输入验证。

## 最终报告（简短）

1. M1 修复了哪几条、commit hash。
2. M2 模块与线程图；keymap 如何保证 keyId 对齐。
3. Raw Input/aggregator 的计数口径；Channel 的 seq/重连/暂停处理。
4. 测试结果：`cargo test` 数量、1000 键、重复、长按、组合键、滚轮、暂停、p99、CPU。
5. 截图路径；仍然存在的偏差与风险（UIPI、反作弊、多显示器/DPI）。
