// 包入口：由 DSH 插件加载器导入（见 package.json "main"）。
// 与 dsh-dafeiyu 相同的防护：依赖缺失时退化为惰性插件，不拖垮整个插件树。
let plugin
try {
  plugin = await import('./plugin.js')
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(
    '[dsh-remote] 插件依赖加载失败，本次启动已自动停用（不影响 DSH 其他功能）。\n'
    + `[dsh-remote] 原因: ${detail}\n`
    + '[dsh-remote] 修复: 完全退出 DSH 后重新安装 dsh-remote 最新版。',
  )
  plugin = { name: 'dsh-remote', inject: [], apply() {} }
}

export const name = plugin.name
export const inject = plugin.inject
export const Config = plugin.Config

export function apply(ctx, config = {}) {
  return plugin.apply(ctx, config)
}
