# Windows 代码签名证书怎么选 / 怎么找

> 先分清两件事：
>
> - **Tauri 自动更新签名**：minisign 密钥，免费，必须自己生成；用于让应用相信“这个更新包是我发的”。
> - **Windows 代码签名证书**：由公共 CA 签发，用于减少 SmartScreen / 杀软对安装包的拦截。**不是自动更新的前置条件。**

## 先说什么不需要买

如果你只是要：

- GitHub Releases 发布安装包；
- 应用内检查更新、下载、安装；
- 安装时用户点一次“仍要运行”也能接受；

那么只需要 Tauri updater 的 minisign 密钥，**不需要买 Windows 代码签名证书**。安装包会显示“未知发布者”，SmartScreen 可能拦一次，但不影响更新机制本身。

## 需要买的时候买哪种

### OV 代码签名证书

适合：

- 独立开发者 / 小团队；
- 常规桌面软件；
- 预算有限，但想让发布者显示为公司/组织名称。

特点：

- 需要组织（公司/个体工商户等）资料做验证；
- 私钥通常放在硬件 token / HSM 中；
- 价格通常比 EV 低；
- SmartScreen 信誉仍需要下载量积累，不是买完立刻全绿。

### EV 代码签名证书

适合：

- 商业软件、驱动、需要更高信任背书的发布；
- 有持续发布和证书预算。

特点：

- 审核更严格；
- 必须使用硬件 token / HSM；
- 价格更高；
- 对 SmartScreen 更友好，但同样不保证“零拦截”。

### 开源项目专用

如果仓库是公开开源项目，可以先看：

- **SignPath Foundation**：为符合条件的开源项目提供免费代码签名；
- **Certum Open Source Code Signing**：面向开源项目的低价/特殊证书；
- 部分 CA 对开源项目有折扣，需要邮件申请。

这些通常需要审核项目公开度、构建流程和发布方式，周期比直接买更长。

### 微软 Azure Artifact Signing（原 Trusted Signing）

微软的云签名服务，按月订阅，不需要自己买 USB token；但对组织资质、Azure 订阅、身份验证有要求。适合已经用 Azure 的团队。

## 去哪儿买

优先从 CA 官方或官方授权代理商买，不要从来源不明的个人店买“成品证书”。

常见品牌：

- DigiCert
- Sectigo
- SSL.com
- GlobalSign
- Certum（欧洲，价格通常较低）
- 国内代理商：天威诚信、锐成信息、亚洲诚信等

搜索关键词：

```text
代码签名证书 OV
代码签名证书 EV
Certum code signing
Sectigo code signing
```

购买前问清楚：

1. 是否包含 **硬件 token / HSM**；
2. 是否支持 **Windows Authenticode**；
3. 是否支持 **时间戳服务**；
4. 证书有效期和续费价格；
5. 是否支持 **开源项目折扣**；
6. 能否开具发票；
7. 换电脑/CI 签名是否支持。

## 大致的预算

价格随 CA、年限、代理商变化很大。2026 年国内渠道常见区间大致是：

- OV：约 ¥3,000–5,000 / 年；
- EV：约 ¥6,000–8,000+ / 年；
- 云签名（Azure Artifact Signing）：按月订阅，通常比买 EV 硬件证书门槛低。

具体以 CA/代理商报价为准，不要拿这个区间当合同价。

## 申请流程

1. 选 CA / 代理商，确认 OV 或 EV；
2. 提交组织资料（营业执照、电话、地址等）和联系人；
3. CA 做组织验证 / 回拨；
4. 收到硬件 token 或开通云签名；
5. 在 Windows 上安装证书驱动，或配置 CI 的云签名；
6. 用 `signtool` 对 `.exe` / `.msi` 签名并加时间戳；
7. 发布后观察 SmartScreen 反馈。

## 建议

- **现在**：先接 Tauri updater 的 minisign，GitHub Releases 可以先发未签名包；
- **有预算后**：买 OV 即可，除非有驱动/企业采购要求，不必一上来 EV；
- 如果走开源路线：先申请 SignPath Foundation 或 Certum 开源证书，能省不少钱。

## 参考

- [Tauri Updater 文档](https://v2.tauri.app/plugin/updater/)
- [Tauri GitHub 发布流水线](https://v2.tauri.app/distribute/pipelines/github/)
- [SSL.com Code Signing](https://www.ssl.com/products/software-integrity/code-signing/)
- [Sectigo Code Signing](https://www.sectigo.com/ssl-certificates-tls/code-signing)
- [Certum Open Source Code Signing](https://shop.certum.eu/open-source-code-signing.html)
- [SignPath Foundation](https://signpath.org/)
- [Azure Artifact Signing 定价](https://azure.microsoft.com/zh-cn/pricing/details/artifact-signing/)
- [Azure Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
