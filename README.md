# dsh-remote 🐋

> DeepSeek Harness 手机远程控制插件：扫一下二维码，用手机指挥你的 Agent。
> 局域网 / IPv6 / Cloudflare 隧道三通道，令牌鉴权，Windows 开箱即用。
>
> A remote-control plugin for DeepSeek Harness — scan a QR code and drive your agent from your phone.

[English](README_EN.md) · [使用文档](docs/USAGE.zh-CN.md) · [注意事项](docs/NOTES.zh-CN.md) · [更新日志](CHANGELOG.md)

## ✨ 功能

- 📋 **会话总览**：手机查看全部会话与实时运行状态（含子 Agent 标记）
- 💬 **对话阅读**：Markdown / 表格 / 代码块渲染，色彩突出重点；历史消息分页加载
- ✉️ **远程指挥**：给任意会话发消息（忙时自动排队）、停止任务、新建会话
- 📎 **图片与文件**：手机上传，图片自动转 JPEG 压缩；Agent 经视觉工具（modlens）读图
- 🌐 **三通道连接**：局域网直连（首选）· Cloudflare 外网隧道（HTTPS，任何网络可用）· IPv6 直连（备用）
- 🔐 **安全内置**：令牌鉴权、配对页仅限本机、隧道来源隔离

## 🌟 特色

| 特色 | 说明 |
| --- | --- |
| 📱 手机零安装 | 只需浏览器（iOS Safari 即可），无需 App、无需公网 IP、无需升级系统 |
| 🧰 一体化配对页 | 二维码、隧道一键开关（实时日志 + 超时诊断）、视觉 Key 填写、令牌旋转——全在一个页面，不依赖插件设置页 |
| 🚀 Windows 开箱即用 | 安装包内置 cloudflared（52MB → 压缩后 18MB），打开隧道开关即可用，无需下载任何东西 |
| 🖼 纯文本模型也能看图 | 图片由 Agent 调用视觉工具读成文字证据；视觉 Key 在配对页粘贴即自动配置 |
| 🛡 防御式设计 | 服务惰性获取（开机时序安全）、错误落盘、老浏览器兼容、虚拟网卡过滤 |

## 📦 安装

### tgz 安装（推荐）

```bash
# 从 Releases 下载 dsh-remote-1.2.0.tgz，或自行打包：
pnpm pack
# 桌面端 profile
dsh plugin --profile desktop add "D:\path\to\dsh-remote-1.2.0.tgz"
# WebUI profile
npx -y @deepseek-ai/dsh plugin --profile web add "D:\path\to\dsh-remote-1.2.0.tgz"
```

重启 DeepSeek Harness 后，电脑打开 **http://127.0.0.1:4666/**，手机扫码即可。

### 源码安装

```bash
git clone <仓库地址> && cd dsh-remote
pnpm install && pnpm pack   # 注意：仓库不含 cloudflared 二进制，见下方说明
```

## ⚙️ 配置后即可使用

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| enabled | true | 总开关 |
| port | 4666 | HTTP 服务端口 |
| bind | lan | `lan` = 0.0.0.0（手机可访问）；`loopback` = 仅本机 |
| token | 留空自动生成 | 访问令牌，内嵌在二维码链接中 |
| tunnel | false | Cloudflare 快速隧道（也可在配对页一键开启）|
| cloudflaredPath | 空 | 自定义 cloudflared 路径 |
| visionKey | 空 | 图片识别 Gemini Key（配对页填写，自动写入 modlens 配置）|

> 隧道程序：tgz / Release 已内置 Windows 版 cloudflared；**源码仓库不含二进制**（体积大），
> 源码安装用户请从 [Cloudflare 官方](https://github.com/cloudflare/cloudflared/releases) 下载放到 `~/.dsh/bin/`。
> 图片识别：需安装 [modlens](https://github.com/liustack/modlens) 视觉插件。

## 🧭 工作原理

```
┌──────────┐   QR（含令牌）   ┌────────────────────────────┐
│ 手机浏览器 │ ────────────────► │ dsh-remote 插件（DSH Host 内）│
└──────────┘    http/https     │  · 自带 HTTP 服务（默认 4666）  │
   ▲                           │  · 令牌鉴权 / 配对页本机隔离     │
   │                           │  · 惰性调用 DSH sessionController│
   └── 三通道 ◄────────────────┴────────────────────────────┘
    局域网 IP / IPv6 直连 / Cloudflare 隧道（HTTPS，任何网络）
```

## ⚠️ 已知问题（尚待修复）

| # | 问题 | 影响与规避 |
| --- | --- | --- |
| 1 | 部分网络无法建立 Cloudflare 快速隧道（运营商拦截 UDP 7844 等）| 隧道卡住时配对页有日志与超时诊断；可改用局域网 / 自行搭建固定隧道 |
| 2 | 快速隧道域名随机，重连后变化 | 出门前刷新一次二维码；永久固定需自建命名隧道 + 域名 |
| 3 | 手机端不支持应答「审批 / 提问确认」| Agent 等待确认时需回电脑操作（下版本规划）|
| 4 | 无推送通知 | iPhone 锁屏后轮询暂停，解锁即恢复（下版本规划）|
| 5 | 局域网通道为明文 HTTP | 同一 Wi-Fi 内理论上可被嗅探；敏感场景请用隧道或 `loopback + 隧道` 组合 |
| 6 | 上传目录不自动清理 | 手动清理 `~/.dsh/dsh-remote-uploads/` |
| 7 | DSH 插件设置页的配置卡片在部分环境不渲染 | 已把关键配置全部搬到配对页；设置页渲染为后续优化 |
| 8 | macOS / Linux 未实测 | 移动页与核心逻辑跨平台；cloudflared 需自行下载对应版本 |

## 📌 注意事项

- **令牌 = 遥控钥匙**：拿到令牌即可控制 DSH，请勿外传；配对页与令牌旋转仅限本机访问，隧道来源被强制隔离
- **防火墙**：首次使用放行 node 入站（专用 + 公用都勾；手机热点通常算公用网络）
- **代理共存**：系统代理模式无影响；TUN 模式请将 `*.trycloudflare.com` 等设为 DIRECT
- **iPhone**：同一时间只能运行一个 VPN；iOS 18 的 Safari「不安全连接警告」会拦 http 链接（设置 → App → Safari 关闭，或直接用隧道码）；微信扫码限制 http 外链，用系统相机扫
- **隐私**：图片会发送给你配置的视觉引擎服务商；Key 只存本机（`~/.modlens/config.json`，0600）
- 完整说明见 [docs/NOTES.zh-CN.md](docs/NOTES.zh-CN.md)

## 🗂 目录结构

```
├── src/                    # 插件源码（index/plugin/server/api/settings-scope + 静态页面）
├── tools/gen-qr.mjs        # 离线二维码生成器（可选工具）
├── docs/                   # 使用文档与注意事项
├── cordis.patch.yml        # 插件行插入补丁
└── CHANGELOG.md            # 更新日志
```

## 常见问题速查

| 现象 | 处理 |
| --- | --- |
| 手机提示「仅 HTTPS」| 关闭 Safari「不安全连接警告」，或扫隧道码 |
| 页面空白 | 检查地址栏是否被改成 `https://`（删 s 重试 / 换 Chrome）|
| 只有局域网和 IPv6 码 | 点配对页「开启外网隧道」；看状态与日志 |
| 发图 Agent 读不懂 | 安装 modlens 并在配对页填视觉 Key |
| 只能看到部分消息 | 会话顶部点「↑ 加载更早的消息」|

## 许可

MIT。内置组件：[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（MIT）· cloudflared（Apache-2.0，仅随 tgz/Release 分发）。
