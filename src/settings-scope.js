import Schema from '@deepseek-ai/schemastery'

// 与 dsh-dafeiyu 相同的 settings 访问模式：
// - DSH 0.2：项目化 settings（describe / update / settings/document-updated）
// - 旧 Host：ctx.settings.register 命名空间注册
export function plainConfig(config) {
  if (config && typeof config.get === 'function') return plainConfig(config.get())
  if (Array.isArray(config)) return config.map(plainConfig)
  if (config && typeof config === 'object') {
    return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, plainConfig(value)]))
  }
  return config
}

export function createSettingsScope(ctx, schema, config, normalize, fallbackNs) {
  // 启动早期设置服务可能尚未就绪：所有读取都做防御，失败时退回基础配置，
  // 避免开机时序问题把整个插件 fiber 打挂。
  let base
  try {
    base = normalize(plainConfig(config))
  } catch (error) {
    base = normalize({})
    try { ctx.logger?.warn?.(`dsh-remote 初始配置读取失败: ${error instanceof Error ? error.message : String(error)}`) } catch { /* 忽略 */ }
  }
  if (typeof ctx.settings?.register === 'function') {
    const legacySchema = Schema.object(Object.fromEntries(Object.entries(schema.dict)
      .map(([key, field]) => [key, field.extra('volatile', false)])))
    return ctx.settings.register(fallbackNs, legacySchema, { base, applies: 'live' })
  }
  const service = ctx.settings
  const namespace = ctx.fiber?.entry?.options?.id ?? fallbackNs
  const watchers = new Set()
  let value = base
  let reading = false
  const read = () => {
    if (reading) return value
    reading = true
    try {
      const entry = service?.describe?.().find((row) => row.ns === namespace)
      return normalize({ ...plainConfig(config), ...entry?.value, ...entry?.user })
    } catch (error) {
      try { ctx.logger?.warn?.(`dsh-remote 设置读取失败（使用缓存值）: ${error instanceof Error ? error.message : String(error)}`) } catch { /* 忽略 */ }
      return value
    } finally {
      reading = false
    }
  }
  const adopt = (next) => {
    if (JSON.stringify(next) === JSON.stringify(value)) return
    value = next
    for (const watcher of watchers) watcher(value)
  }
  const refresh = () => {
    try { adopt(read()) } catch (error) { ctx.logger?.warn?.('dsh-remote settings refresh failed', error) }
  }
  const offDocument = ctx.on?.('settings/document-updated', (ns) => {
    if (ns === namespace && !reading) refresh()
  }, { global: true })
  const offVolatile = ctx.on?.('loader/volatile-update', refresh)
  return {
    get: () => value,
    watch(callback) {
      watchers.add(callback)
      return () => watchers.delete(callback)
    },
    ...(typeof service?.update === 'function' ? {
      async update(patch) {
        await service.update(namespace, patch)
        adopt(normalize({ ...value, ...patch }))
      },
    } : {}),
    dispose() {
      offDocument?.()
      offVolatile?.()
      watchers.clear()
    },
  }
}
