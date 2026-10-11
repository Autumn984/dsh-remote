// 离线二维码生成器：读取本机 dsh-remote 配对信息，生成含 SVG 二维码的网页文件。
// 用途：当配对页不方便打开、或需要快速给手机扫码时使用。
// 用法: node tools/gen-qr.mjs [输出路径]     （默认输出到桌面 DSH远程控制二维码.html）
// 依赖: 本机 dsh-remote 服务运行中（默认 http://127.0.0.1:4666）
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 该库是经典脚本且所在包声明了 "type":"module"，用 Function 沙箱执行最稳妥
const libPath = fileURLToPath(new URL('../src/static/qrcode.min.js', import.meta.url))
const libSrc = readFileSync(libPath, 'utf8')
const factory = new Function('module', 'exports', `${libSrc}\nreturn module.exports`)
const qrcode = factory({ exports: {} }, {})

const out = process.argv[2] || join(homedir(), 'Desktop', 'DSH远程控制二维码.html')

let info
try {
  info = await (await fetch('http://127.0.0.1:4666/api/pairing-info')).json()
} catch (error) {
  console.error('无法连接本机 dsh-remote 服务（4666）:', error.message)
  process.exit(1)
}

const entries = []
if (info.tunnel) entries.push(['外网隧道（任何网络可用）', info.tunnel.url])
for (const a of info.ipv6 ?? []) entries.push([`IPv6 直连 · ${a.ip}`, a.url])
const skip = /^192\.168\.56\.|^192\.168\.137\.|^169\.254\./
for (const a of info.lan ?? []) {
  if (skip.test(a.ip)) continue // VirtualBox Host-Only / Windows ICS / 链路本地
  entries.push([`局域网 · ${a.ip}`, a.url])
}

function svgFor(text) {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
}

const cards = entries.map(([label, url]) => `
  <div class="card">
    <h2>${label}</h2>
    <div class="qr">${svgFor(url)}</div>
    <div class="url">${url}</div>
  </div>`).join('\n')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH 远程控制 · 扫码连接</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px 20px; background:#0d1117; color:#e6edf3;
         font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  h1 { font-size:22px; margin:0 0 20px; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:20px; margin-bottom:20px; }
  .card h2 { font-size:15px; color:#8b949e; margin:0 0 12px; font-weight:600; }
  .qr { display:flex; justify-content:center; background:#fff; border-radius:10px; padding:12px; }
  .url { font-size:12px; word-break:break-all; color:#58a6ff; margin-top:12px; line-height:1.5; }
  .tip { color:#8b949e; font-size:13px; line-height:1.8; }
</style></head><body>
<h1>DSH 远程控制 · 扫码连接</h1>
${cards || '<div class="tip">没有可用的连接方式（服务可能未启动）</div>'}
<div class="tip">
用手机相机扫码，在浏览器打开后点「添加到主屏幕」。<br>
外出时用「外网隧道」码；同一 Wi-Fi 用「局域网」码。<br>
若隧道码不在，说明插件设置的「启用 Cloudflare 外网隧道」还未打开。
</div>
</body></html>`

writeFileSync(out, html, 'utf8')
console.log(`written: ${out} (${entries.length} 个二维码)`)
