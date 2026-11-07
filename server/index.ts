import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Hub } from './hub'
import { OpenCodeError } from './opencode'

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const hub = new Hub(root)
await hub.initialize()

const configuredPort = Number(process.env.PORT ?? hub.config.port ?? 5178)
const port = Number.isFinite(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
  ? Math.floor(configuredPort)
  : 5178

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message })
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new HttpError(413, '请求体过大')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

function requireMethod(request: IncomingMessage, method: string): void {
  if (request.method !== method) throw new HttpError(405, `仅支持 ${method}`)
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const dist = path.join(root, 'dist')
  if (!fs.existsSync(dist)) {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end('OpenCode Deck API 已启动。\n开发模式请访问 Vite 地址（默认 http://127.0.0.1:5173）；生产模式请先 npm run build。\n')
    return
  }
  let relative = decodeURIComponent(pathname)
  if (relative === '/' || relative === '') relative = '/index.html'
  const filePath = path.resolve(dist, `.${relative}`)
  const distRoot = path.resolve(dist)
  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
    throw new HttpError(403, '非法路径')
  }
  let stat: fs.Stats | null = null
  try { stat = fs.statSync(filePath) } catch { stat = null }
  if (stat?.isDirectory()) {
    const indexPath = path.join(filePath, 'index.html')
    if (fs.existsSync(indexPath)) {
      stat = fs.statSync(indexPath)
      return sendFile(request, response, indexPath, stat)
    }
  }
  if (!stat) {
    const accept = request.headers.accept ?? ''
    const hasExtension = path.extname(relative) !== ''
    if (!hasExtension && accept.includes('text/html')) {
      const indexPath = path.join(dist, 'index.html')
      if (fs.existsSync(indexPath)) return sendFile(request, response, indexPath, fs.statSync(indexPath))
    }
    throw new HttpError(404, '文件不存在')
  }
  return sendFile(request, response, filePath, stat)
}

function sendFile(request: IncomingMessage, response: ServerResponse, filePath: string, stat: fs.Stats): void {
  const ext = path.extname(filePath).toLowerCase()
  const isHtml = ext === '.html'
  const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`)
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : isHtml ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
  stream.pipe(response)
}

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  if (pathname === '/api/health' && request.method === 'GET') {
    const online = hub.agents.filter((agent) => agent.connection.status === 'online').length
    sendJson(response, 200, { ok: true, online, service: hub.serviceInfo.status, now: Date.now() })
    return
  }

  if (pathname === '/api/stream' && request.method === 'GET') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    response.flushHeaders?.()
    hub.addClient(response)
    return
  }

  if (pathname === '/api/bootstrap' && request.method === 'GET') {
    sendJson(response, 200, hub.bootstrap())
    return
  }

  if (pathname === '/api/config' && request.method === 'POST') {
    const body = await readJson(request)
    sendJson(response, 200, await hub.updateConfig(body))
    return
  }

  if (pathname === '/api/discover' && request.method === 'POST') {
    sendJson(response, 200, await hub.discoverService())
    return
  }

  if (pathname === '/api/auto-load' && request.method === 'POST') {
    sendJson(response, 200, await hub.autoLoad())
    return
  }

  if (pathname === '/api/service/start' && request.method === 'POST') {
    sendJson(response, 200, await hub.startSharedService())
    return
  }

  if (pathname === '/api/service/stop' && request.method === 'POST') {
    sendJson(response, 200, await hub.stopSharedService())
    return
  }

  if (pathname === '/api/projects' && request.method === 'GET') {
    sendJson(response, 200, await hub.listProjects())
    return
  }

  if (pathname === '/api/send' && request.method === 'POST') {
    const body = await readJson(request)
    const targets = Array.isArray(body.targets) ? body.targets.filter((value: unknown): value is string => typeof value === 'string') : []
    const text = typeof body.text === 'string' ? body.text : ''
    const delivery = body.delivery === 'steer' ? 'steer' : 'queue'
    sendJson(response, 200, await hub.sendMany(targets, text, delivery))
    return
  }

  const interactionMatch = pathname.match(/^\/api\/agents\/([^/]+)\/(permission|form)\/([^/]+)$/)
  if (interactionMatch) {
    requireMethod(request, 'POST')
    const agentID = decodeURIComponent(interactionMatch[1]!)
    const kind = interactionMatch[2]!
    const requestID = decodeURIComponent(interactionMatch[3]!)
    const body = await readJson(request)
    if (kind === 'permission') {
      if (!['once', 'always', 'reject'].includes(body.decision)) throw new HttpError(400, 'decision 必须是 once、always 或 reject')
      await hub.replyPermission(agentID, requestID, body.decision, typeof body.message === 'string' ? body.message : undefined)
    } else {
      if (!body.answer || typeof body.answer !== 'object' || Array.isArray(body.answer)) throw new HttpError(400, '缺少 answer 对象')
      await hub.replyForm(agentID, requestID, body.answer as Record<string, unknown>)
    }
    sendJson(response, 200, { ok: true })
    return
  }

  const match = pathname.match(/^\/api\/agents\/([^/]+)\/(sessions|session|prompt|interrupt|sync|seen|follow)$/)
  if (match) {
    const agentID = decodeURIComponent(match[1]!)
    const action = match[2]!

    if (action === 'sessions') {
      requireMethod(request, 'GET')
      sendJson(response, 200, await hub.listSessions(agentID))
      return
    }

    if (action === 'session') {
      requireMethod(request, 'POST')
      const body = await readJson(request)
      if (body.create) {
        sendJson(response, 200, await hub.createSession(agentID, typeof body.title === 'string' ? body.title : undefined))
      } else {
        if (typeof body.sessionId !== 'string' || !body.sessionId) throw new HttpError(400, '缺少 sessionId')
        sendJson(response, 200, await hub.selectSession(agentID, body.sessionId))
      }
      return
    }

    if (action === 'prompt') {
      requireMethod(request, 'POST')
      const body = await readJson(request)
      if (typeof body.text !== 'string') throw new HttpError(400, '缺少 text')
      await hub.sendPrompt(agentID, body.text, body.delivery === 'steer' ? 'steer' : 'queue')
      sendJson(response, 200, { ok: true })
      return
    }

    if (action === 'interrupt') {
      requireMethod(request, 'POST')
      await hub.interrupt(agentID)
      sendJson(response, 200, { ok: true })
      return
    }

    if (action === 'sync') {
      requireMethod(request, 'POST')
      sendJson(response, 200, await hub.syncNow(agentID))
      return
    }

    if (action === 'seen') {
      requireMethod(request, 'POST')
      await hub.seen(agentID)
      sendJson(response, 200, { ok: true })
      return
    }

    if (action === 'follow') {
      requireMethod(request, 'POST')
      const body = await readJson(request)
      sendJson(response, 200, await hub.setFollow(agentID, Boolean(body.follow)))
      return
    }
  }

  throw new HttpError(404, `未知接口：${pathname}`)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  const pathname = url.pathname
  void (async () => {
    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(request, response, pathname)
      } else {
        if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '仅支持 GET')
        await serveStatic(request, response, pathname)
      }
    } catch (error) {
      if (response.headersSent) {
        try { response.end() } catch { /* ignore */ }
        return
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.message)
        return
      }
      if (error instanceof OpenCodeError) {
        sendError(response, error.status && error.status >= 400 && error.status < 500 ? 400 : 502, error.message)
        return
      }
      console.error('[http]', error)
      sendError(response, 500, error instanceof Error ? error.message : '服务器内部错误')
    }
  })()
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n端口 ${port} 已被占用。请关闭占用该端口的程序，或设置 PORT 环境变量后重试。\n`)
  } else {
    console.error('[server]', error)
  }
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  console.log('')
  console.log('  OpenCode Deck')
  console.log(`  API / 监控面板： http://127.0.0.1:${port}`)
  console.log(`  共享服务：      ${hub.serviceInfo.status === 'online' ? hub.serviceInfo.url : '未连接（可在设置中启动）'}`)
  console.log('')
})

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n正在关闭…')
  hub.shutdown()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1_500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
