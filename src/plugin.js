import Schema from '@deepseek-ai/schemastery'
import { createSettingsScope, plainConfig } from './settings-scope.js'
import { createApi } from './api.js'
import { createRemoteServer } from './server.js'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const name = 'dsh-remote'

// settings 是本插件的唯一硬依赖：配置（端口 / 绑定 / 令牌）全部走它持久化。
// sessionController / sessions 通过可选访问获取，缺失时移动端只显示"服务不可用"，
// 不影响 DSH 其他功能。
export const inject = ['settings']

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用手机远程控制'),
  port: Schema.number().min(1024).max(65535).default(4666).description('HTTP 服务端口'),
  bind: Schema.union([
    Schema.const('lan').description('局域网 0.0.0.0（手机可访问）'),
    Schema.const('loopback').description('仅本机 127.0.0.1'),
  ]).default('lan').description('监听地址'),
  token: Schema.string().role('secret').default('').description('访问令牌（留空自动生成，改后旧设备需重新扫码）'),
  tunnel: Schema.boolean().default(false).description('启用 Cloudflare 外网隧道（手机在任何网络都能访问）'),
  cloudflaredPath: Schema.string().default('').description('cloudflared.exe 路径（留空自动查找 ~/.dsh/bin/cloudflared.exe，Windows 示例：C:\\Users\\<用户名>\\.dsh\\bin\\cloudflared.exe）'),
  visionKey: Schema.string().role('secret').default('').description('图片识别的 Gemini API Key：填写后自动写入 modlens 配置（需已安装 modlens 插件），留空则用 modlens 自身配置'),
}).description('DSH 手机远程控制（iPhone 扫码即用）')

// 标记为 volatile：当前 DSH 将每个 volatile 字段作为实时引用下发，
// 且 settings.update 只接受 volatile 字段的合并（令牌持久化 / 旋转依赖它）。
for (const [key, field] of Object.entries(Config.dict)) Config.dict[key] = field.volatile()

const defaults = Object.freeze({
  enabled: true,
  port: 4666,
  bind: 'lan',
  token: '',
  tunnel: false,
  cloudflaredPath: '',
  visionKey: '',
})

function normalize(config) {
  const c = plainConfig(config) ?? {}
  return {
    enabled: c.enabled !== false,
    port: Number.isFinite(c.port) && c.port >= 1024 && c.port <= 65535 ? c.port : defaults.port,
    bind: c.bind === 'loopback' ? 'loopback' : 'lan',
    token: typeof c.token === 'string' ? c.token : '',
    tunnel: c.tunnel === true,
    cloudflaredPath: typeof c.cloudflaredPath === 'string' ? c.cloudflaredPath : '',
    visionKey: typeof c.visionKey === 'string' ? c.visionKey : '',
  }
}

export function apply(ctx, config = {}) {
  try {
    return applyInner(ctx, config)
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    try {
      appendFileSync(join(homedir(), '.dsh', 'dsh-remote-error.log'), `[${new Date().toISOString()}] ${detail}\n\n`)
    } catch { /* 忽略写日志失败 */ }
    ctx.logger?.error?.(`dsh-remote apply failed: ${detail}`)
    throw error
  }
}

function applyInner(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const settings = createSettingsScope(ctx, Config, config, normalize, 'dsh-remote')
  const api = createApi(ctx, logger)

  let server
  let token = settings.get().token || ''
  let stopped = false
  let runningPort = -1
  let runningBind = ''
  const markRunning = (port, bind) => { runningPort = port; runningBind = bind }

  // —— Cloudflare 快速隧道 ——
  let tunnelProc
  let tunnelUrl = ''
  let tunnelState = 'off' // off | missing-binary | starting | ready | exited
  let tunnelOverride = null // 配对页按钮的手动覆盖（持久化失败时仍生效）
  let tunnelStartAt = 0
  const tunnelLog = []
  const pushLog = (line) => {
    const text = String(line).trim().slice(0, 160)
    if (!text) return
    tunnelLog.push(text)
    if (tunnelLog.length > 8) tunnelLog.shift()
  }
  const tunnelOn = () => tunnelOverride !== null ? tunnelOverride : settings.get().tunnel === true
  const effectiveTunnelState = () => {
    if (tunnelState === 'starting' && tunnelStartAt && Date.now() - tunnelStartAt > 60000) return 'timeout'
    return tunnelState
  }
  const resolveCloudflared = () => {
    const cfg = settings.get()
    if (cfg.cloudflaredPath) return cfg.cloudflaredPath
    const userPath = join(homedir(), '.dsh', 'bin', `cloudflared${process.platform === 'win32' ? '.exe' : ''}`)
    if (existsSync(userPath)) return userPath
    // 包内自带 Windows 版（开源仓库不含此二进制，见 .gitignore 与 README）
    const bundled = join(dirname(fileURLToPath(import.meta.url)), 'native', 'cloudflared.exe')
    if (process.platform === 'win32' && existsSync(bundled)) return bundled
    return userPath
  }
  const stopTunnel = () => {
    const proc = tunnelProc
    tunnelProc = undefined
    tunnelUrl = ''
    tunnelState = tunnelOn() ? 'starting' : 'off'
    if (proc) { try { proc.kill() } catch { /* 忽略关闭错误 */ } }
  }
  const startTunnel = () => {
    stopTunnel()
    const cfg = settings.get()
    if (!tunnelOn()) { tunnelState = 'off'; return }
    const exe = resolveCloudflared()
    if (!existsSync(exe)) {
      tunnelState = 'missing-binary'
      logger.warn?.(`dsh-remote 隧道未启动：找不到 ${exe}（Windows 安装包已自带；其他系统请从 Cloudflare 下载 cloudflared 放到该路径）`)
      return
    }
    tunnelState = 'starting'
    tunnelStartAt = Date.now()
    pushLog('cloudflared 启动中…')
    const proc = spawn(exe, ['tunnel', '--url', `http://127.0.0.1:${cfg.port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    tunnelProc = proc
    const scan = (chunk) => {
      pushLog(chunk)
      if (tunnelUrl) return
      const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match) {
        tunnelUrl = match[0]
        tunnelState = 'ready'
        logger.info?.(`dsh-remote 隧道就绪: ${tunnelUrl}`)
      }
    }
    proc.stdout?.on('data', scan)
    proc.stderr?.on('data', scan)
    proc.on('error', (error) => {
      tunnelState = 'exited'
      pushLog(`进程错误: ${error instanceof Error ? error.message : String(error)}`)
      logger.warn?.(`dsh-remote 隧道进程错误: ${error instanceof Error ? error.message : String(error)}`)
    })
    proc.on('exit', (code) => {
      if (tunnelProc === proc) {
        tunnelProc = undefined
        tunnelUrl = ''
        tunnelState = 'exited'
        pushLog(`进程退出 code=${code ?? 'null'}`)
        logger.warn?.(`dsh-remote 隧道退出 code=${code ?? 'null'}（隧道链接会变化，请重新查看配对页）`)
      }
    })
  }
  const setTunnelEnabled = async (on) => {
    tunnelOverride = on
    if (on) startTunnel()
    else { stopTunnel(); tunnelState = 'off' }
    if (typeof settings.update === 'function') {
      settings.update({ tunnel: on }).catch((error) => {
        logger.warn?.(`dsh-remote 隧道开关持久化失败（本次运行内存中生效）: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  // —— 视觉 Key → modlens 配置同步 ——
  // 用户在插件设置页填 Gemini Key 后，自动写入 modlens 的配置文件，
  // 让 Agent 的图片识别（modlens_read_image 工具）开箱即用。
  let lastVisionKey = ''
  const resolveModlensCli = () => {
    try {
      const pkg = require.resolve('@liustack/modlens/package.json')
      return join(dirname(pkg), 'dist', 'main.js')
    } catch {
      return undefined
    }
  }
  const syncVisionKey = () => {
    const key = (settings.get().visionKey || '').trim()
    if (!key || key === lastVisionKey) return
    lastVisionKey = key
    const cli = resolveModlensCli()
    if (!cli) {
      logger.warn?.('dsh-remote: 已保存视觉 Key，但未找到 modlens 包——请安装 @liustack/modlens 插件后图片识别才会生效')
      return
    }
    const proc = spawn(process.execPath, [cli, 'config', 'set', 'gemini-api.apiKey', key], { stdio: 'ignore', windowsHide: true })
    proc.on('error', (error) => {
      logger.warn?.(`dsh-remote: 写入 modlens Key 失败: ${error instanceof Error ? error.message : String(error)}`)
    })
    proc.on('exit', (code) => {
      if (code === 0) logger.info?.('dsh-remote: 视觉 Key 已写入 modlens 配置')
      else logger.warn?.(`dsh-remote: 写入 modlens Key 异常 exit=${code ?? 'null'}`)
    })
  }
  syncVisionKey()

  const ensureToken = async () => {
    if (token) return token
    const next = randomBytes(18).toString('hex')
    token = next
    if (typeof settings.update === 'function') {
      settings.update({ token: next }).catch((error) => {
        logger.warn?.(`dsh-remote 令牌持久化失败（本次运行内存中仍可用）: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    return next
  }

  const start = async () => {
    if (stopped || server) return
    const cfg = settings.get()
    if (cfg.enabled === false) return
    await ensureToken()
    const instance = createRemoteServer({
      getToken: () => token,
      getTunnelUrl: () => tunnelUrl,
      getTunnelEnabled: () => tunnelOn(),
      getTunnelState: () => effectiveTunnelState(),
      getTunnelLog: () => tunnelLog.slice(),
      setTunnelEnabled,
      getVisionKeyState: () => ((settings.get().visionKey || '').trim() ? 'set' : 'unset'),
      setVisionKey: async (key) => {
        if (typeof settings.update === 'function') {
          settings.update({ visionKey: key }).catch((error) => {
            logger.warn?.(`dsh-remote 视觉 Key 持久化失败（本次运行内存中生效）: ${error instanceof Error ? error.message : String(error)}`)
          })
        }
        syncVisionKey()
      },
      api,
      rotateToken: async () => {
        const next = randomBytes(18).toString('hex')
        token = next
        if (typeof settings.update === 'function') {
          settings.update({ token: next }).catch((error) => {
            logger.warn?.(`dsh-remote 令牌持久化失败（本次运行内存中仍可用）: ${error instanceof Error ? error.message : String(error)}`)
          })
        }
        return next
      },
      logger,
    })
    server = instance
    try {
      // lan 模式优先绑定 '::'（Windows 双栈：同时接受 IPv4 与 IPv6），
      // 让手机可通过校园网 IPv6 直连；'::' 不可用时回退 0.0.0.0。
      let host = cfg.bind === 'lan' ? '::' : '127.0.0.1'
      let info
      try {
        info = await instance.listen(cfg.port, host)
      } catch (v6Error) {
        if (host !== '::') throw v6Error
        host = '0.0.0.0'
        info = await instance.listen(cfg.port, host)
      }
      markRunning(cfg.port, cfg.bind)
      if (cfg.tunnel) startTunnel()
      const lan = cfg.bind === 'lan' ? '（局域网 IPv4 + IPv6 可访问，需放行 Windows 防火墙）' : ''
      logger.info?.(`dsh-remote 已启动: http://${info.host}:${info.port} ${lan}`)
    } catch (error) {
      server = undefined
      logger.warn?.(`dsh-remote 端口 ${cfg.port} 启动失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const stop = async () => {
    const instance = server
    server = undefined
    if (instance) {
      try { await instance.close() } catch { /* 忽略关闭错误 */ }
    }
  }

  // 设置变化实时生效：关闭开关 → 停服；改端口 / 绑定 → 重启；改令牌 → 热替换；隧道开关独立启停；视觉 Key → 同步 modlens
  let prevTunnel = settings.get().tunnel
  const unwatch = settings.watch((next) => {
    if (next.token && next.token !== token) token = next.token
    if ((next.visionKey || '') !== lastVisionKey) syncVisionKey()
    if (next.enabled === false) {
      markRunning(-1, '')
      stopTunnel()
      void stop()
      prevTunnel = next.tunnel
      return
    }
    const needRestart = server
      && (next.port !== runningPort || next.bind !== runningBind)
    if (!server || needRestart) {
      void stop().then(() => start())
    }
    if (next.tunnel !== prevTunnel) {
      if (next.tunnel) startTunnel()
      else stopTunnel()
    }
    prevTunnel = next.tunnel
  })

  void start()

  ctx.effect(() => () => {
    stopped = true
    unwatch()
    stopTunnel()
    void stop()
    settings.dispose?.()
  })
}
