# 发布到 GitHub

这份文档只讲发布链路，不包含任何私钥。仓库准备好后按顺序做。

## 1. 建仓库并推代码

在 GitHub 新建空仓库（建议 **Public**，自动更新直接读 `releases/latest/download/latest.json` 最省事）。

```powershell
cd 'D:\Code\壳隐\HandPulse'
git remote add origin git@github.com:<你的用户名>/HandPulse.git
git branch -M main
git push -u origin main
```

如果仓库是 Private，自动更新不能直接访问 Releases 下载地址，需要自己加带认证的更新服务；不建议第一版这样做。

## 2. 先跑 CI

`.github/workflows/ci.yml` 会在 push / PR 时跑：

- 前端 `npm run build`
- Rust `cargo test`
- `cargo clippy --all-targets -- -D warnings`

仓库 Settings → Actions → General 确保允许 Actions。

## 3. 发一个版本

`.github/workflows/release.yml` 由 tag 触发：

```powershell
git tag v0.9.9
git push origin v0.9.9
```

工作流会：

- 把 `v0.9.9` 的版本号同步到 `package.json` / `Cargo.toml` / `tauri.conf.json`；
- 在 Windows runner 上构建 NSIS + MSI；
- 创建 **草稿 Release**，上传安装包；
- 到 GitHub Release 页面检查后点 Publish。

## 4. 接入自动更新（updater）

自动更新和 Windows 代码签名是两件事。**Tauri updater 要的是它自己的 minisign 密钥，不是代码签名证书。**

### 4.1 生成 updater 密钥

在发布机器上执行一次：

```powershell
cd app
npm run tauri signer generate -- -w "$env:USERPROFILE\handpulse-updater.key"
```

会生成：

- `handpulse-updater.key`：**私钥，绝对不能提交仓库**；
- `handpulse-updater.key.pub`：公钥，填到 `tauri.conf.json`。

私钥丢失后无法再给已安装用户推送更新，务必离线备份。

### 4.2 配置 Tauri updater

安装插件：

```powershell
cd app
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
cd src-tauri
cargo add tauri-plugin-updater tauri-plugin-process
```

`tauri.conf.json` 的 `plugins.updater` 写 `pubkey` / `endpoints`：

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<handpulse-updater.key.pub 的内容>",
      "endpoints": [
        "https://github.com/<用户名>/HandPulse/releases/latest/download/latest.json"
      ]
    }
  }
}
```

`bundle.createUpdaterArtifacts` 放在 `src-tauri/tauri.updater.conf.json` 里，只让 Release 构建启用，避免本地普通构建强制要求签名私钥：

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  }
}
```

Rust 侧注册：

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

capabilities 里加 updater / process 权限。

### 4.3 CI 里注入私钥

仓库 Settings → Secrets and variables → Actions：

- `TAURI_SIGNING_PRIVATE_KEY`：私钥文件内容；
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成密钥时设置的密码。

然后把 `.github/workflows/release.yml` 里的：

```yaml
uploadUpdaterJson: false
```

改成：

```yaml
uploadUpdaterJson: true
```

这样每次 Release 会同时上传安装包、`.sig` 和 `latest.json`。

### 4.4 应用内检查更新

Tauri updater 的典型逻辑：

```ts
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const update = await check();
if (update) {
  // 弹窗：update.version / update.body
  await update.downloadAndInstall();
  await relaunch();
}
```

建议做成：

- 启动后静默检查一次；
- 设置页提供“检查更新”按钮；
- 有更新时弹窗显示版本和更新说明，由用户确认；
- 下载中显示进度，安装完重启。

## 5. Windows 代码签名证书

不买证书也能发 GitHub Release、也能做 updater；只是安装时 SmartScreen 会提示“未知发布者”。

需要减少拦截时再买。见 [CODE_SIGNING.md](CODE_SIGNING.md)。

## 6. 发布检查清单

- [ ] `cargo test` / `cargo clippy` 通过
- [ ] 版本号三处一致
- [ ] tag 推送到 GitHub
- [ ] Release 中的 NSIS / MSI 都存在
- [ ] 用上一版安装包升级到新版，数据库保留
- [ ] 自动更新：旧版能检测到新版并安装
- [ ] 私钥、密码不在仓库里

## 7. 国内镜像

如果用户无法直连 GitHub，可以让自有服务器直接从 GitHub 最新**正式** Release 拉取：

```text
/var/www/handpulse/
  HandPulse_<version>_x64-setup.exe
  HandPulse_<version>_x64-setup.exe.sig
  HandPulse_<version>_x64_en-US.msi
  HandPulse_<version>_x64_en-US.msi.sig
  latest.json
  index.html
  CHANGELOG.md
```

服务器上的 `sync.py` 每 10 分钟请求 GitHub API 的 `releases/latest`，重新生成指向本机的 `latest.json`，再用 `rsync --delete` 删除旧安装包。只同步正式发布，草稿不会同步。

```bash
python3 /home/ubuntu/handpulse-mirror/sync.py
```

`tauri.conf.json` 中把镜像放在 GitHub 前面：

```json
"endpoints": [
  "https://huohandu.cn/handpulse/latest.json",
  "https://github.com/HuoHanDu/HandPulse/releases/latest/download/latest.json"
]
```

这样国内用户优先走自有服务器；服务器不可用时自动回退 GitHub。

部署细节：

- 目录：`/var/www/handpulse`，nginx `location /handpulse/`；
- 同步脚本：`/home/ubuntu/handpulse-mirror/sync.py`；
- cron：`*/10 * * * * /usr/bin/python3 /home/ubuntu/handpulse-mirror/sync.py`；
- 同步脚本不需要 GitHub Token，使用的是公开 Release API。
