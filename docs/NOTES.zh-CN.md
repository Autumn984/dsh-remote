# 注意事项（Notes & Security）

## 安全模型

1. **令牌 = 遥控钥匙**：任何拿到令牌的设备都能控制你的 DSH。令牌内嵌在二维码链接中，请勿截图外发、勿提交到仓库。
2. **配对页仅限本机**：二维码、令牌、令牌旋转接口只对 127.0.0.1 开放；局域网内其他设备无法打开配对页。
3. **隧道来源隔离**：经 Cloudflare 隧道进来的请求（带 `cf-connecting-ip` 头）只能访问移动页与带令牌的 API，永远拿不到配对页与令牌旋转接口。
4. **局域网通道是明文 HTTP**：同一 Wi-Fi 内的其他设备理论上可嗅探。敏感环境请使用外网隧道（HTTPS）或将 `bind` 设为 `loopback` + 隧道组合。
5. **别把 4666 端口直接端口映射到公网**。
6. 令牌随机生成（36 位十六进制）并持久化到 DSH 设置文档；重启不会变化，除非手动旋转。

## 网络与环境

- **与代理软件共存**：系统代理模式无影响（cloudflared 为 Go 程序，不读 Windows 系统代理）。若使用 TUN 模式（虚拟网卡接管全局），请将 `*.trycloudflare.com`、`region1.v2.argotunnel.com` 及 Cloudflare 回源地址设为 DIRECT，否则隧道可能变慢或重连。
- **校园网/公司网**：出站 HTTPS 到 Cloudflare 通常放行；IPv6 入站可能被防火墙拦截，打不开就换隧道。
- **iPhone**：
  - 同一时间只能运行一个 VPN——用隧道时无需开任何代理；
  - iOS 18 的 Safari「不安全连接警告」会拦 http 链接（见使用文档排错）；
  - 微信等第三方扫码入口可能限制 http 外链，用系统相机扫。
- **电脑别休眠**：远程场景下电脑需保持开机、DSH 运行、cloudflared 在线。
- **隧道随机域名**：trycloudflare 快速隧道重连后 URL 变化，手机旧链接失效。出发前刷新二维码；永久固定需自建命名隧道 + 域名。

## 隐私与数据

- 上传的图片/文件保存在本机 `~/.dsh/dsh-remote-uploads/`，不会自动删除，请定期清理。
- 图片识别依赖 Agent 环境中的视觉工具及其引擎（如 modlens + Gemini）；图片会发送给对应引擎服务商，请自行遵守其条款、注意敏感图片。
- `visionKey`（Gemini key）会通过 modlens CLI 写入 `~/.modlens/config.json`（文件权限 0600），只存本机、不随插件分发、不进入日志。
- 本插件自身不发起任何网络请求（除 cloudflared 隧道进程）。

## 开发与部署

- 插件在 DSH Host 进程内运行；服务通过 `ctx.get()` **惰性获取**——开机早期服务未就绪时优雅降级，不要改成直接属性访问（cordis 会抛 "cannot get property without inject"）。
- 每次修改模块代码（api.js / server.js 等）都需要重启 DSH 生效；仅 `src/static/mobile.html` 与 cordis.patch.yml 配置可热更新。
- 打包前确认 `.gitignore` 生效：**不要提交任何密钥、令牌、日志与 tgz**。
- `tools/gen-qr.mjs` 为可选工具：在本机服务运行时生成独立二维码网页（`node tools/gen-qr.mjs [输出路径]`）。
- 如需发布 npm：`pnpm pack` 产物即为可安装包；`dependencies` 只有 `@deepseek-ai/schemastery`。
