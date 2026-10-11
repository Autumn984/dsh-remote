// dsh-remote 自带 HTTP 服务器（node:http，零外部依赖）。
// 与 DSH 自身 Web 服务分离：独立端口 + 独立令牌鉴权，
// 不接触 DSH 的 Web 认证面；绑定 0.0.0.0 时手机可通过局域网 / Tailscale 访问。
import http from 'node:http'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const STATIC = join(here, 'static')

const VERSION = '0.1.0'

function isLoopback(req) {
  const addr = req.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function tokenFrom(req) {
  const url = new URL(req.url ?? '/', 'http://dsh-remote.local')
  return url.searchParams.get('t') ?? String(req.headers['x-dsh-remote-token'] ?? '')
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('invalid json') }
}

function lanAddresses(port, token) {
  const result = []
  const virtual = /vmnet|virtualbox|veth|hyper-v|wsl|docker|loopback|bluetooth|tap-|tun/i
  const ifaces = os.networkInterfaces()
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (virtual.test(name)) continue
    for (const addr of addrs ?? []) {
      if (addr.internal) continue
      if (addr.family === 'IPv4') {
        if (/^169\.254\./.test(addr.address)) continue // 链路本地地址（无网关）
        const kind = /tailscale/i.test(name) ? 'tailscale' : /wi-?fi|wlan|wireless/i.test(name) ? 'wifi' : 'lan'
        const label = /tailscale/i.test(name) ? 'Tailscale 网络' : /wi-?fi|wlan|wireless/i.test(name) ? `Wi-Fi（${name}）` : `局域网（${name}）`
        result.push({ kind, label, ip: addr.address, url: `http://${addr.address}:${port}/m?t=${encodeURIComponent(token)}` })
      } else if (addr.family === 'IPv6') {
        // 只收录全局单播地址（2000::/3），跳过链路本地与回环
        if (!/^(2[0-9a-f]{3}|3[0-9a-f]{3}):/i.test(addr.address)) continue
        if (addr.address.includes('%')) continue
        result.push({ kind: 'ipv6', label: `IPv6 直连（备用 · ${name}）`, ip: addr.address, url: `http://[${addr.address}]:${port}/m?t=${encodeURIComponent(token)}` })
      }
    }
  }
  return result
}

let qrLibCache
function qrLib() {
  if (!qrLibCache) qrLibCache = readFile(join(STATIC, 'qrcode.min.js'), 'utf8').catch(() => '')
  return qrLibCache
}

async function renderPairing(port, token, tunnelUrl) {
  const lib = await qrLib()
  const addrs = lanAddresses(port, token)
  const ip6 = addrs.filter((a) => a.kind === 'ipv6')
  const lan = addrs.filter((a) => a.kind !== 'tailscale' && a.kind !== 'ipv6')
  const ts = addrs.filter((a) => a.kind === 'tailscale')
  const tun = tunnelUrl ? { label: '外网隧道（任何网络可用）', url: `${tunnelUrl}/m?t=${encodeURIComponent(token)}` } : null
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH 远程控制 · 配对</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px 48px; background: #0d1117; color: #e6edf3;
         font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p.sub { color: #8b949e; margin: 0 0 28px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 15px; margin: 0 0 12px; color: #8b949e; font-weight: 600; }
  .qrwrap { display: flex; justify-content: center; padding: 6px; background: #fff; border-radius: 10px; }
  .url { font-size: 12px; word-break: break-all; color: #58a6ff; margin: 12px 0; line-height: 1.5; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  button { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px;
           padding: 8px 14px; font-size: 13px; cursor: pointer; }
  button:hover { background: #30363d; }
  .token { font-family: ui-monospace, Consolas, monospace; font-size: 13px; word-break: break-all;
           background: #0d1117; border: 1px dashed #30363d; border-radius: 8px; padding: 10px; margin: 14px 0 8px; }
  .note { margin-top: 28px; color: #8b949e; font-size: 13px; line-height: 1.8; }
  .note b { color: #e6edf3; }
  .empty { color: #f0883e; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 16px 20px; }
</style>
</head>
<body>
  <h1>🐋 DSH 远程控制 · 配对</h1>
  <p class="sub">用 iPhone 相机扫描二维码，或在手机 Safari 打开下面的链接（iOS 18.7 可直接使用，无需升级系统）。</p>
  <div id="empty" class="empty" style="display:none">
    未检测到局域网 IPv4 地址。请检查网络连接；若使用 Tailscale，请确认已登录同一账号。
  </div>
  <div class="grid">
    <div id="lan" style="display:none">
      <div class="card"><h2 id="lan-title">局域网（首选）</h2><div class="qrwrap"><div id="qr-lan"></div></div>
      <div class="url" id="url-lan"></div>
      <div class="row"><button onclick="copyUrl('lan')">复制链接</button></div></div>
    </div>
    <div id="tun" style="display:none">
      <div class="card"><h2 id="tun-title">外网隧道（任何网络可用）</h2><div class="qrwrap"><div id="qr-tun"></div></div>
      <div class="url" id="url-tun"></div>
      <div class="row"><button onclick="copyUrl('tun')">复制链接</button></div></div>
    </div>
    <div id="ip6" style="display:none">
      <div class="card"><h2 id="ip6-title">IPv6 直连（备用）</h2><div class="qrwrap"><div id="qr-ip6"></div></div>
      <div class="url" id="url-ip6"></div>
      <div class="row"><button onclick="copyUrl('ip6')">复制链接</button></div></div>
    </div>
    <div id="ts" style="display:none">
      <div class="card"><h2 id="ts-title">Tailscale</h2><div class="qrwrap"><div id="qr-ts"></div></div>
      <div class="url" id="url-ts"></div>
      <div class="row"><button onclick="copyUrl('ts')">复制链接</button></div></div>
    </div>
  </div>
  <div class="card" style="margin-top:20px">
    <h2>外网隧道</h2>
    <div id="tunstatus" style="font-size:13px;color:#8b949e;line-height:1.8">读取中…</div>
    <div class="row" style="margin-top:8px"><button id="tunbtn" style="display:none" onclick="toggleTunnel()">开启外网隧道</button></div>
    <pre id="tunlog" style="display:none;margin-top:10px;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto"></pre>
  </div>
  <div class="card" style="margin-top:20px">
    <h2>图片识别 · 视觉 Key（可选）</h2>
    <div id="visionstatus" style="font-size:13px;color:#8b949e;line-height:1.8">读取中…</div>
    <div class="row" style="margin-top:8px;align-items:center">
      <input id="visionkey" type="password" placeholder="粘贴 Gemini API Key" style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:8px 10px;font-size:13px">
      <button onclick="saveVisionKey()">保存</button>
      <button onclick="saveVisionKey('')">清除</button>
    </div>
    <div style="font-size:12px;color:#484f58;margin-top:8px;line-height:1.7">免费申请：aistudio.google.com（需代理）。保存后自动写入 modlens 配置；需已安装 modlens 插件。Key 只存本机，不随插件分发。</div>
  </div>
  <div class="card" style="margin-top:20px">
    <h2>访问令牌</h2>
    <div class="token" id="token"></div>
    <div class="row">
      <button onclick="rotate()">重新生成令牌（旧设备将断开）</button>
      <button onclick="copyToken()">复制令牌</button>
    </div>
  </div>
  <div class="note">
    <b>使用步骤</b><br>
    1. 同一 Wi-Fi / 手机热点：扫「局域网」码（首选，最快）；<br>
    2. 外出：扫「外网隧道」码（需在插件设置开启隧道，走 Cloudflare，任何网络可用）；IPv6 直连为备用方案，打不开请换局域网码；<br>
    3. 首次启动若 Windows 防火墙弹出提示，请勾选允许（建议专用、公用网络都勾选；热点通常被识别为公用网络）；<br>
    4. 页面空白时，检查浏览器地址栏是否被自动改成 https://（把 s 删掉重试，或换 Chrome）；<br>
    5. 本页面仅限电脑本机访问，令牌即安全凭证，请勿外传。<br>
    <b>提示</b>：二维码里的链接已包含令牌；隧道链接在重连后会变化，出发前先看一眼本页确认最新链接。
  </div>
<script>
/* __QR_LIB__ */
var LAN = [], TS = [], IP6 = [], TUN = null;
var TUN_ENABLED = false, TUN_STATE = '', TUN_LOG = [], VISION_STATE = '';
var token = '__TOKEN__';
function qr(el, text) {
  el.innerHTML = '';
  var q = qrcode(0, 'M');
  q.addData(text); q.make();
  // 固定尺寸 SVG：部分老浏览器对 scalable SVG 会渲染成 0 尺寸
  el.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2 });
}
function render() {
  var ip6 = IP6[0] || null;
  var lan = LAN[0] || null;
  var ts = TS[0] || null;
  document.getElementById('empty').style.display = (ip6 || lan || ts || TUN) ? 'none' : 'block';
  document.getElementById('tun').style.display = TUN ? 'block' : 'none';
  document.getElementById('ip6').style.display = ip6 ? 'block' : 'none';
  document.getElementById('lan').style.display = lan ? 'block' : 'none';
  document.getElementById('ts').style.display = ts ? 'block' : 'none';
  if (TUN) {
    document.getElementById('tun-title').textContent = TUN.label;
    document.getElementById('url-tun').textContent = TUN.url;
    qr(document.getElementById('qr-tun'), TUN.url);
  }
  if (ip6) {
    document.getElementById('ip6-title').textContent = ip6.label + ' · ' + ip6.ip;
    document.getElementById('url-ip6').textContent = ip6.url;
    qr(document.getElementById('qr-ip6'), ip6.url);
  }
  if (lan) {
    document.getElementById('lan-title').textContent = lan.label + ' · ' + lan.ip;
    document.getElementById('url-lan').textContent = lan.url;
    qr(document.getElementById('qr-lan'), lan.url);
  }
  if (ts) {
    document.getElementById('ts-title').textContent = ts.label + ' · ' + ts.ip;
    document.getElementById('url-ts').textContent = ts.url;
    qr(document.getElementById('qr-ts'), ts.url);
  }
  document.getElementById('token').textContent = token;
}
function copyText(t) { if (navigator.clipboard) { navigator.clipboard.writeText(t); } }
function renderTun() {
  var el = document.getElementById('tunstatus');
  var btn = document.getElementById('tunbtn');
  var logEl = document.getElementById('tunlog');
  if (TUN_STATE === 'ready') { el.innerHTML = '✅ 外网隧道已就绪，上方出现隧道二维码'; btn.style.display = 'none'; logEl.style.display = 'none'; }
  else if (TUN_STATE === 'starting' || TUN_ENABLED) { el.innerHTML = '⏳ 隧道启动中…（约 10~20 秒，页面会自动刷新）'; btn.style.display = 'none'; logEl.style.display = TUN_LOG.length ? '' : 'none'; }
  else if (TUN_STATE === 'timeout') { el.innerHTML = '⚠️ 隧道连接超时（60 秒未建立）。可能原因：网络限制 Cloudflare（UDP 7844 被拦）、安全软件拦截 cloudflared、或桌面有弹窗未确认。'; btn.textContent = '重试开启隧道'; btn.style.display = ''; logEl.style.display = 'none'; }
  else if (TUN_STATE === 'exited') { el.innerHTML = '⚠️ 隧道进程已退出。请查看下方日志；若是安全软件拦截，请在弹窗中允许后重试。'; btn.textContent = '重试开启隧道'; btn.style.display = ''; logEl.style.display = 'none'; }
  else if (TUN_STATE === 'missing-binary') { el.innerHTML = '⚠️ 未找到 cloudflared（Windows 安装包已自带；其他系统请下载后放到 ~/.dsh/bin/）'; btn.style.display = 'none'; logEl.style.display = 'none'; }
  else { el.innerHTML = '外网隧道未开启：<b>出门在外时开启</b>（任何网络都能连回电脑）'; btn.textContent = '开启外网隧道'; btn.style.display = ''; logEl.style.display = 'none'; }
  if (logEl.style.display !== 'none') logEl.textContent = TUN_LOG.join('\n');
}
function toggleTunnel() {
  fetch('/api/tunnel/toggle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"on":true}' })
    .then(function () { refresh(); })
    .catch(function () { alert('开启失败'); });
}
function saveVisionKey(key) {
  var k = typeof key === 'string' ? key : document.getElementById('visionkey').value.trim();
  fetch('/api/vision-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k }) })
    .then(function (r) { return r.json(); })
    .then(function () { document.getElementById('visionkey').value = ''; return refresh(); })
    .catch(function () { alert('保存失败'); });
}
function renderVision() {
  var el = document.getElementById('visionstatus');
  if (VISION_STATE === 'set') el.innerHTML = '✅ 已配置（Agent 可以用视觉工具读图了）';
  else el.innerHTML = '未配置：发图片前先填一个 Gemini Key（免费，见下方说明）';
}
function copyUrl(k) { var a = (k === 'tun' ? TUN : k === 'ip6' ? IP6 : k === 'ts' ? TS : LAN)[0]; if (a) copyText(a.url); }
function copyToken() { copyText(token); }
function rotate() {
  fetch('/api/token/rotate', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (j) { token = j.token; return refresh(); })
    .catch(function () { alert('旋转失败'); });
}
function refresh() {
  return fetch('/api/pairing-info')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      LAN = j.lan; TS = j.tailscale; IP6 = j.ipv6 || []; token = j.token;
      TUN_ENABLED = j.tunnelEnabled === true; TUN_STATE = j.tunnelState || '';
      TUN_LOG = j.tunnelLog || [];
      VISION_STATE = j.visionKeyState || 'unset';
      TUN = j.tunnel ? { label: '外网隧道（任何网络可用）', url: j.tunnel.url } : null;
      render(); renderTun(); renderVision();
    });
}
render();
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>`.replace('/* __QR_LIB__ */', () => lib).replaceAll("'__TOKEN__'", () => JSON.stringify(token))
}

export function createRemoteServer({ getToken, getTunnelUrl, getTunnelEnabled, getTunnelState, getTunnelLog, setTunnelEnabled, getVisionKeyState, setVisionKey, api, rotateToken, logger }) {
  const sockets = new Set()
  let server

  const auth = (req) => {
    const current = getToken()
    if (!current) return false
    const given = tokenFrom(req)
    return given === current
  }

  const handle = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh-remote.local')
    const path = url.pathname
    try {
      // 经 Cloudflare 隧道进来的请求（带 cf-connecting-ip 头）只允许移动页与带令牌的 API，
      // 配对页 / 配对信息 / 令牌旋转 / 隧道开关仅限真正的本机访问。
      const viaTunnel = !!req.headers['cf-connecting-ip']
      if (viaTunnel && (path === '/' || path === '/api/pairing-info' || path === '/api/token/rotate' || path === '/api/tunnel/toggle' || path === '/api/vision-key')) {
        return json(res, 403, { error: '该接口仅限本机访问', code: 'forbidden' })
      }
      // —— 本机专用：配对信息 / 令牌旋转 / 隧道开关 / 视觉 Key ——
      if (path === '/api/pairing-info' || path === '/api/token/rotate' || path === '/api/tunnel/toggle' || path === '/api/vision-key') {
        if (!isLoopback(req)) return json(res, 403, { error: '仅限本机访问' })
        if (path === '/api/pairing-info') {
          const addrs = lanAddresses(server.address().port, getToken())
          const tun = getTunnelUrl()
          return json(res, 200, {
            token: getToken(),
            lan: addrs.filter((a) => a.kind !== 'tailscale' && a.kind !== 'ipv6'),
            tailscale: addrs.filter((a) => a.kind === 'tailscale'),
            ipv6: addrs.filter((a) => a.kind === 'ipv6'),
            tunnel: tun ? { url: `${tun}/m?t=${encodeURIComponent(getToken())}` } : null,
            tunnelEnabled: typeof getTunnelEnabled === 'function' ? getTunnelEnabled() : false,
            tunnelState: typeof getTunnelState === 'function' ? getTunnelState() : 'unknown',
            tunnelLog: typeof getTunnelLog === 'function' ? getTunnelLog() : [],
            visionKeyState: typeof getVisionKeyState === 'function' ? getVisionKeyState() : 'unset',
          })
        }
        if (path === '/api/token/rotate') {
          if (typeof rotateToken !== 'function') return json(res, 500, { error: '旋转不可用', code: 'internal' })
          const next = await rotateToken()
          return json(res, 200, { token: next })
        }
        if (path === '/api/tunnel/toggle' && req.method === 'POST') {
          if (typeof setTunnelEnabled !== 'function') return json(res, 500, { error: '隧道开关不可用', code: 'internal' })
          const body = await readBody(req, 4096)
          await setTunnelEnabled(body.on === true)
          return json(res, 200, { ok: true, enabled: body.on === true })
        }
        if (path === '/api/vision-key' && req.method === 'POST') {
          if (typeof setVisionKey !== 'function') return json(res, 500, { error: '视觉 Key 不可用', code: 'internal' })
          const body = await readBody(req, 4096)
          const key = typeof body.key === 'string' ? body.key.trim() : ''
          await setVisionKey(key)
          return json(res, 200, { ok: true })
        }
      }

      // —— 页面 ——
      if (path === '/' || path === '/m') {
        const mobile = path === '/m' || !isLoopback(req)
        if (!mobile && isLoopback(req)) {
          const html = await renderPairing(server.address().port, getToken(), getTunnelUrl())
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          return res.end(html)
        }
        // 移动端：URL 里带正确令牌才放行页面本身
        if (!auth(req)) {
          res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
          return res.end('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px;background:#0d1117;color:#e6edf3"><h2>需要访问令牌</h2><p>请用电脑上的配对页面二维码重新扫码打开（链接中需包含 ?t=令牌）。</p></body>')
        }
        const html = await readFile(join(STATIC, 'mobile.html'), 'utf8')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(html)
      }

      // —— API（令牌鉴权）——
      if (path.startsWith('/api/')) {
        if (!auth(req)) return json(res, 401, { error: '令牌无效或缺失', code: 'unauthorized' })
        if (path === '/api/status') {
          const result = await api.status()
          return json(res, result.ok === false ? 502 : 200, { name: 'dsh-remote', version: VERSION, host: os.hostname(), ...result })
        }
        let match
        if ((match = path.match(/^\/api\/session\/([^/]+)\/transcript$/))) {
          const beforeParam = url.searchParams.get('before')
          const result = await api.transcript(decodeURIComponent(match[1]), beforeParam ? Number(beforeParam) : undefined)
          return json(res, result.ok ? 200 : 502, result)
        }
        if ((match = path.match(/^\/api\/session\/([^/]+)\/prompt$/)) && req.method === 'POST') {
          const body = await readBody(req, 32 * 1024 * 1024) // 支持附件上传，放宽到 32MB
          const text = typeof body.text === 'string' ? body.text.trim() : ''
          const attachments = Array.isArray(body.attachments)
            ? body.attachments.filter((a) => a && typeof a === 'object')
            : []
          if (!text && !attachments.length) return json(res, 400, { error: '消息内容为空', code: 'bad-request' })
          const result = await api.prompt(decodeURIComponent(match[1]), text, attachments)
          return json(res, result.ok ? 200 : 502, result)
        }
        if ((match = path.match(/^\/api\/session\/([^/]+)\/cancel$/)) && req.method === 'POST') {
          const result = await api.cancel(decodeURIComponent(match[1]))
          return json(res, result.ok ? 200 : 502, result)
        }
        if (path === '/api/session' && req.method === 'POST') {
          const body = await readBody(req)
          const result = await api.create(body.cwd)
          return json(res, result.ok ? 200 : 502, result)
        }
        return json(res, 404, { error: '未知接口', code: 'not-found' })
      }

      json(res, 404, { error: 'not found' })
    } catch (error) {
      logger?.warn?.('dsh-remote request failed', error)
      try { json(res, 500, { error: error instanceof Error ? error.message : String(error), code: 'internal' }) } catch { /* socket 已关闭 */ }
    }
  }

  return {
    async listen(port, host) {
      server = http.createServer(handle)
      server.on('connection', (socket) => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, resolve)
      })
      const addr = server.address()
      return { host, port: addr.port }
    },
    async close() {
      const instance = server
      server = undefined
      if (!instance) return
      await new Promise((resolve) => instance.close(resolve))
      for (const socket of sockets) socket.destroy()
      sockets.clear()
    },
  }
}
