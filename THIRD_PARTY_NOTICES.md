# Third-party notices

本仓库的源代码与打包脚本使用什么许可证，见根目录的 `LICENSE`（如果尚未添加，则默认保留所有权利）。

下面这些资源/内容由第三方提供，不随项目代码许可证一起授权：

## 手柄示意图 SVG

- 文件：`app/src/components/controller/xbox.svg`、`ps.svg`、`switch.svg`
- 来源：GamepadTester.cn（https://www.gamepadtester.cn/）页面中的内联 SVG
- 版权归原网站/原作者所有
- 当前仅作为本项目的本地手柄适配界面参考与展示使用，**不属于本项目代码许可证的授权范围**
- 如果要公开再分发、商用或修改后发布，请先确认原站授权，或替换为自有/CC0 授权的图形

如果原站要求移除，请删除这三个文件，并替换 `ControllerGraphic.tsx` 中的底图引用。

## 字体

- **Inter**：SIL Open Font License 1.1，Rasmus Andersson
  - https://github.com/rsms/inter
- **JetBrains Mono**：SIL Open Font License 1.1，JetBrains
  - https://github.com/JetBrains/JetBrainsMono

字体文件位于 `app/src/assets/fonts/`。

## 其他

- 项目中的界面、图表、键鼠图形为项目自有实现；
- 早期设计原型位于 `design-demos/`，仅作设计过程记录。
