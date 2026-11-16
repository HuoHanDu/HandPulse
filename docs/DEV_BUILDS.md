# 开发版流程

小改动先直接在 dev 窗口里看，不编译安装包，也不改版本号：

```powershell
cd app
npm run tauri dev
```

1. 改代码后由 Vite / Tauri watcher 热更新；
2. 用户在当前 dev 窗口里确认效果；
3. 多轮修改都保持当前已发布版本号（例如 0.9.19）；
4. 用户确认后，再统一递增版本号、打 tag、运行 Release 工作流、发布。

开发期间不生成 `dev-builds` 安装包，也不上传服务器；避免把未确认的中间产物当成正式版本。

## 管理员权限

正式 `release` 构建会嵌入 `requireAdministrator` 清单，双击启动时由 Windows 弹 UAC；开发构建（`tauri dev` / debug）不要求管理员，方便迭代。

这样正式版可以读取以管理员运行的游戏/前台进程，代价是每次启动都要确认 UAC。
