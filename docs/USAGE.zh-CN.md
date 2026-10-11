# dsh-remote 使用文档

> 适用：DeepSeek Harness 桌面端 + 任意手机浏览器（iOS Safari / Android Chrome）

## 一、快速开始

1. 安装插件并重启 DSH
2. 电脑浏览器打开配对页 **http://127.0.0.1:4666/**
3. 手机与电脑连**同一 Wi-Fi**，用手机相机扫「局域网」二维码
4. 在浏览器中点「添加到主屏幕」，之后像 App 一样使用

> 配对页仅限本机访问；局域网内其他设备直接访问会提示需要令牌。

## 二、三种连接方式

### A. 局域网直连（最快，在家/办公室）

| 条件 | 说明 |
| --- | --- |
| 同一路由器 | 电脑与手机连同一 Wi-Fi |
| 防火墙 | Windows 首次会弹窗，勾选「专用网络」允许 |
| IP 变化 | 电脑 IP 被 DHCP 重新分配后需重扫（令牌不变）|

### B. IPv6 直连（校园网等有公网 IPv6 的环境）

配对页会自动列出全局 IPv6 地址（过滤了链路本地与虚拟网卡）。手机用蜂窝数据（国内运营商默认有 IPv6）或支持 IPv6 的 Wi-Fi 扫码即可直连，无需任何隧道。

若扫码打不开，多半是网络防火墙拦了 IPv6 入站——改用方式 C。

### C. Cloudflare 外网隧道（任何网络可用）⭐

1. 下载 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) 放到 `~/.dsh/bin/cloudflared`（Windows: `cloudflared.exe`）
2. 插件设置中打开「启用 Cloudflare 外网隧道」
3. 配对页出现「外网隧道」二维码（HTTPS），手机在任何网络扫码即可

> 快速隧道为随机域名，**重连后会变化**：出发前刷新一次二维码。想要永久固定链接，可自建 Cloudflare 命名隧道 + 自有域名，并把 `cloudflaredPath` 指向你的隧道配置（需自行实现 `tunnel run` 模式；本插件内置的是 `tunnel --url` 快速模式）。

## 三、手机端界面

| 区域 | 说明 |
| --- | --- |
| 会话列表 | 标题、运行中（转圈）/ 空闲、最后活动时间、工作目录；子 Agent 有徽标 |
| 会话详情 | 用户消息蓝色、Agent 消息深色；标题/加粗/列表/表格/代码块按 Markdown 渲染；工具调用与思考块默认不显示 |
| ↑ 加载更早的消息 | 逐页（300 事件/页）加载历史 |
| 📎 附件 | 选图片/文件，最多 4 个，可预览、可移除 |
| 发送 | 文字 + 附件一起发；Agent 忙时排队 |
| 停止 | 取消当前任务 |

轮询：会话列表 3 秒、对话 2 秒；滚动位置与阅读状态在刷新间保持。

## 四、图片与文件

- **图片**：手机端自动转 JPEG（HEIC 也支持）、压缩到 1600px 内；上传到 `~/.dsh/dsh-remote-uploads/`；Agent 收到路径后通过视觉工具（如 modlens）读图
- **文件**：原样保存到同一目录，Agent 用文件工具读取
- 限制：单个附件 ≤ 24MB（文件类建议 ≤ 8MB），每次 ≤ 4 个

## 五、配置参考

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| enabled | true | 总开关 |
| port | 4666 | HTTP 端口，改动实时生效 |
| bind | lan | lan = 0.0.0.0 / loopback = 仅本机 |
| token | 自动生成 | 访问令牌；修改后旧设备需重扫 |
| tunnel | false | Cloudflare 快速隧道 |
| cloudflaredPath | 空 | cloudflared 路径，留空自动查 `~/.dsh/bin/` |

命令行安装：

```bash
# 桌面端 profile
dsh plugin --profile desktop add "D:\path\to\dsh-remote-1.0.0.tgz"
# WebUI profile
npx -y @deepseek-ai/dsh plugin --profile web add "D:\path\to\dsh-remote-1.0.0.tgz"
```

## 六、排错

| 现象 | 处理 |
| --- | --- |
| 扫码提示「仅 HTTPS」| iPhone：设置 → App → Safari → 关闭「不安全连接警告」；或改扫隧道码 |
| 微信扫码打不开 | 微信内置浏览器限制 http 外链：改用手机自带相机 |
| 隧道码不在 | 检查 tunnel 开关与 cloudflared 路径；看 DSH 日志 |
| 图片 Agent 读不到内容 | 确认 modlens 等视觉工具已装且引擎已配置 |
| 手机上只有部分消息 | 点「↑ 加载更早的消息」逐页加载 |
| 插件启动失败 | 错误会写入 `~/.dsh/dsh-remote-error.log`；通常重启 DSH 可恢复 |

## 七、卸载

插件列表 → dsh-remote → 移除；手机主屏幕图标长按删除。上传目录 `~/.dsh/dsh-remote-uploads/` 请手动清理。
