# 手脉 HandPulse · 原型网页

> 需求依据：`docs/02-原型需求报告.md`；上游：`docs/01-需求分析报告.md`。
> 风格依据：`D:\Download\DESIGN-apple(1).md`（apple.com 五页设计分析，用户提供）。
> 当前交付：**方向 2 的工作台骨架 + 方向 1 的暗厅视觉**（用户 2026-11-04 选定混搭）。

## 最终版

```
design-demos/HandPulse-Prototype.html
```

单文件：Mock 数据、字体（Inter / JetBrains Mono）都已内嵌，无 CDN、无网络请求，双击即可打开。
四页路由：`#/keyboard`、`#/mouse`、`#/stats`、`#/settings`。

- **结构**：64px 图标轨道 + transport（运行状态 / 日期 / 范围 / 今日动作 / 按键 / 点击 / 时间 / 暂停）+ 输入时间轴 + 主工作区 + 300px inspector。
- **视觉**：纯黑 #000、46px display 负字距标题、单一 Action 蓝 #2997ff、胶囊控件、无卡片边框、键盘作为被顶光打亮的实物（只在它下面有一处阴影感）、596 处留白由黑场承担。
- **简化**：键盘页去掉重复的 60 分钟带宽（transport 的时间轴承担实时），Top10 改成两列十行；鼠标页删掉重复的“每小时点击 / 点击构成”（inspector 里保留构成）；非键盘页隐藏 live tape；所有面板去边框、去卡片感。
- **交互**：导航、范围、显示模式（全部 / 仅热力 / 仅实时）、104/87 布局、Top10 选中、键 hover/点击详情与 ESC、暂停 / 恢复、鼠标图层、直方三 tab、热力两 tab、分页、设置开关、输入 DELETE 清空二次确认。

## 截图

| 页面 | 文件 |
|---|---|
| 键盘 | `design-demos/shots/final-keyboard.png` |
| 鼠标 | `design-demos/shots/final-mouse.png` |
| 数据 | `design-demos/shots/final-stats.png` |
| 设置 | `design-demos/shots/final-settings.png` |
| 1100 宽 | `design-demos/shots/final-1100.png` |

## 三个方向初稿（保留）

`design-demos/dir-1.html`（暗厅）、`dir-2.html`（工作台）、`dir-3.html`（流体玻璃）；
六格缩略图：`design-demos/shots/thumbs.png`；方向卡：`directions.md`；选择记录：`direction-approved.md`。

## 验证

- `design_lint check`：0 红灯（黄灯：等宽读数 24 处、标题用 Inter 代替 SF Pro、外观家族提示）。
- 四个路由控制台 0 error；1440 / 1100 宽均无横向滚动。
- 交互回归：导航 / 布局 104↔87 / 显示模式 / 键详情 / 暂停 / 图层 / 直方与热力 tab / 设置开关与清空确认，均通过。

## 已知取舍（诚实）

- 所有数据是 Mock：今日 17,642 = 按键 12,438 + 点击 5,204；峰值 380 APM（21:03）。
- 键详情的“平均按住 / 最长按住 / 首次 / 最近”、7 天范围、鼠标移动图层是按确定性规则派生的演示值，UI 内已注明。
- 折线 Y 轴按需求从 0 起、上限 400；白天基数低所以左侧贴近底部，是数据形状。
- 键盘键帽上只保留主标，不叠计数：计数在 Top10、inspector、鼠标指标里，避免小键帽上出现两行小字（“简化”的一部分）。
- 版本号（0.9.0 / Core 0.4.2 / schema v3）是占位文案。
