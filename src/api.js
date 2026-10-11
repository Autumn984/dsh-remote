// sessionController / sessions 服务的薄封装。
// 关键约束：cordis 上下文中未注入的服务不允许属性访问（会抛
// "cannot get property without inject"），且服务在开机早期可能尚未就绪。
// 因此全部通过 ctx.get() 惰性获取，每次调用时解析，失败时优雅降级。

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

const TIMEOUT = 20_000
const UPLOAD_DIR = join(homedir(), '.dsh', 'dsh-remote-uploads')

function safeName(name) {
  const base = basename(String(name || 'file').replace(/[\\/:*?"<>|]/g, '_')).slice(0, 120)
  return base || 'file'
}

function describeBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function saveAttachment(att) {
  mkdirSync(UPLOAD_DIR, { recursive: true })
  const name = safeName(att.name)
  const path = join(UPLOAD_DIR, `${Date.now()}-${name}`)
  let bytes
  const data = att.data
  if (typeof data === 'string' && data.startsWith('data:')) {
    bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
  } else if (typeof data === 'string') {
    bytes = Buffer.from(data, 'base64')
  } else {
    throw new Error('附件数据格式错误')
  }
  if (bytes.length === 0) throw new Error('附件内容为空')
  if (bytes.length > 24 * 1024 * 1024) throw new Error('单个附件超过 24MB')
  writeFileSync(path, bytes)
  const isImage = /^image\//.test(String(att.mime || ''))
  return { name, path, size: bytes.length, isImage }
}

function toError(error) {
  if (error?.isDSHRemoteError) {
    const code = error.code ?? 'gateway/internal'
    return { error: error.message ?? 'DSH 服务错误', code }
  }
  return { error: error instanceof Error ? error.message : String(error), code: 'internal' }
}

// 事件序列化：剔除过大的字段（assistant stream、request header 等），
// 只保留移动端渲染所需内容。
const SKIP_TYPES = new Set([
  'system/message',
  'request/header',
  'assistant/attempt',
  'session/end-seed',
])
function wireEvent(event) {
  const data = { ...(event.data ?? {}) }
  delete data.stream
  delete data.header
  return { type: event.type, seq: event.seq, time: event.time, data }
}

export function createApi(ctx, logger) {
  const getController = () => {
    try { return ctx.get?.('sessionController') } catch { return undefined }
  }
  const getSessions = () => {
    try { return ctx.get?.('sessions') } catch { return undefined }
  }
  const available = () => !!getController()

  const summaryFrom = (item) => {
    const projections = item.projections?.values ?? {}
    const raw = projections.title
    let title = ''
    if (typeof raw === 'string' && raw) title = raw
    return {
      id: item.sessionId,
      title,
      running: item.running === true,
      blank: item.blank === true,
      updatedAt: Number(item.updatedAt ?? 0),
      cwd: item.cwd ?? '',
      origin: item.origin ?? null,
      parentSessionId: item.parentSessionId ?? null,
      agentAvailable: item.agentAvailable !== false,
    }
  }

  return {
    available,
    async status() {
      const controller = getController()
      if (!controller) return { ok: true, apiAvailable: false, sessions: [] }
      try {
        const value = await controller.list({}, AbortSignal.timeout(TIMEOUT))
        const items = (value?.items ?? []).map(summaryFrom)
        return { ok: true, apiAvailable: true, sessions: items }
      } catch (error) {
        return { ok: false, apiAvailable: true, sessions: [], ...toError(error) }
      }
    },

    async transcript(sessionId, before) {
      const controller = getController()
      if (!controller) return { error: '会话服务不可用（缺少 sessionController）', code: 'unavailable' }
      const LIMIT = 300
      try {
        let events = []
        let meta = null
        let hasMore = false
        let live = null
        const sessions = getSessions()
        if (sessions?.get) live = sessions.get(sessionId)
        const b = Number(before)
        const wantWindow = Number.isFinite(b) && b > 0
        if (live) {
          const seq = Number(live.seq)
          let from
          let to
          if (wantWindow) {
            to = Math.min(b, seq)
            from = Math.max(0, to - LIMIT)
          } else {
            from = Math.max(0, seq - LIMIT)
            to = seq
          }
          const raw = live.snapshotEvents(from, to)
          events = raw.map(wireEvent).filter((e) => !SKIP_TYPES.has(e.type))
          hasMore = from > 0
          meta = { id: live.id, cwd: live.header?.cwd ?? '', createdAt: live.header?.createdAt ?? 0 }
        } else {
          const inspection = await controller.inspect(sessionId, AbortSignal.timeout(TIMEOUT))
          const all = inspection?.events ?? []
          const picked = wantWindow ? all.filter((e) => Number(e.seq) < b).slice(-LIMIT) : all.slice(-LIMIT)
          events = picked.map(wireEvent).filter((e) => !SKIP_TYPES.has(e.type))
          hasMore = picked.length === LIMIT && picked[0]?.seq > (all[0]?.seq ?? 0)
          const header = inspection?.meta ?? {}
          meta = { id: header.id ?? sessionId, cwd: header.cwd ?? '', createdAt: header.createdAt ?? 0 }
        }
        return { ok: true, id: sessionId, meta, events, hasMore }
      } catch (error) {
        return { ok: false, id: sessionId, meta: null, events: [], hasMore: false, ...toError(error) }
      }
    },

    async prompt(sessionId, text, attachments = []) {
      const controller = getController()
      if (!controller) return { error: '会话服务不可用（缺少 sessionController）', code: 'unavailable' }
      try {
        // 附件：保存到专用目录，并在消息中告诉 Agent 如何读取
        let note = ''
        const list = Array.isArray(attachments) ? attachments.filter((a) => a && typeof a === 'object').slice(0, 5) : []
        if (list.length) {
          const lines = []
          for (const att of list) {
            try {
              const saved = saveAttachment(att)
              lines.push(`- ${saved.name}（${describeBytes(saved.size)}）→ 已保存到 ${saved.path}`)
              if (saved.isImage) {
                lines.push('  （这是一张图片：请用 modlens_read_image 工具读取上述路径，获取图片内容后再回答用户。）')
              } else {
                lines.push('  （这是一个文件：请用文件工具读取上述路径获取内容后再回答用户。）')
              }
            } catch (error) {
              lines.push(`- 附件 ${att?.name ?? '未知'} 保存失败：${error instanceof Error ? error.message : String(error)}`)
            }
          }
          note = '用户从手机端上传了文件：\n' + lines.join('\n')
        }
        const finalText = [typeof text === 'string' && text.trim(), note].filter(Boolean).join('\n\n')
        if (!finalText) return { error: '消息内容为空', code: 'bad-request' }
        const resolved = await controller.resolveAgent(sessionId)
        if (resolved && 'error' in resolved && resolved.error) {
          return { error: resolved.error.message ?? '无法激活会话 Agent', code: resolved.error.code ?? 'session/agent-busy' }
        }
        const requestId = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const value = await controller.prompt({
          requestId,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: finalText }],
        }, AbortSignal.timeout(TIMEOUT))
        return value?.accepted === true ? { ok: true } : { error: 'Agent 未接受消息', code: 'session/rejected' }
      } catch (error) {
        return toError(error)
      }
    },

    async cancel(sessionId) {
      const controller = getController()
      if (!controller) return { error: '会话服务不可用（缺少 sessionController）', code: 'unavailable' }
      try {
        const value = controller.cancel({ sessionId })
        return value?.accepted === true ? { ok: true } : { error: '取消请求未被接受', code: 'session/rejected' }
      } catch (error) {
        return toError(error)
      }
    },

    async create(cwd) {
      const controller = getController()
      if (!controller) return { error: '会话服务不可用（缺少 sessionController）', code: 'unavailable' }
      try {
        const request = {}
        if (typeof cwd === 'string' && cwd.trim()) request.cwd = cwd.trim()
        const value = await controller.create(request)
        return value?.sessionId ? { ok: true, sessionId: value.sessionId } : { error: '创建会话失败', code: 'session/create-failed' }
      } catch (error) {
        return toError(error)
      }
    },
  }
}
