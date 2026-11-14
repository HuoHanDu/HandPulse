# 开发版流程

小改动先出开发版，不创建 GitHub Release，也不推送 tag：

1. 版本号递增到 `0.9.x`，例如 `0.9.20`；
2. 只在本地/开发目录生成安装包；
3. 用户测试并提出修改；
4. 多轮修改确认后，再打 tag、运行 Release 工作流、发布。

开发版安装包放在：

```text
dev-builds/HandPulse_<version>_x64-setup-dev.exe
```

开发版不会上传到 `huohandu.cn/handpulse`，也不会改变 GitHub latest。

正式发布时再同步版本号、tag、Release 和服务器镜像。
