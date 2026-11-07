import type { MessageView, ModelRef, SessionInfo, TokenInfo, ToolCallView } from '../shared/types'

export interface OpenCodeInfo {
  version?: string
  pid?: number
  urls?: string[]
  hostname?: string
}

export class OpenCodeError extends Error {
  status?: number
  code?: string
  details?: unknown

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message)
    this.name = 'OpenCodeError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  timeoutMs?: number
  signal?: AbortSignal
}

interface SessionsResponse {
  data?: SessionInfo[]
}

interface MessagesResponse {
  data?: unknown[]
}

interface CreateSessionResponse {
  data?: SessionInfo
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

export class OpenCodeClient {
  baseUrl: string
  password: string

  constructor(baseUrl: string, password: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.password = password
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`
  }

  private buildUrl(pathname: string, query?: RequestOptions['query']): URL {
    const url = new URL(this.baseUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${pathname}`
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue
        url.searchParams.set(key, String(value))
      }
    }
    return url
  }

  async request<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(pathname, options.query)
    const timeoutMs = options.timeoutMs ?? 15_000
    const signals = [AbortSignal.timeout(timeoutMs)]
    if (options.signal) signals.push(options.signal)
    const signal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals)

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          authorization: this.authHeader(),
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      })
    } catch (error) {
      if (options.signal?.aborted) throw new OpenCodeError('请求已取消', { code: 'aborted' })
      if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
        throw new OpenCodeError(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`, { code: 'timeout' })
      }
      throw new OpenCodeError(`无法连接 OpenCode 服务：${(error as Error).message}`, { code: 'network' })
    }

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = text
      }
    }

    if (!response.ok) {
      const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
      const message = typeof record?.message === 'string'
        ? record.message
        : typeof record?._tag === 'string'
          ? record._tag
          : text.slice(0, 300) || response.statusText
      const friendly = response.status === 401
        ? '认证失败：服务密码不正确'
        : response.status === 404
          ? `接口不存在：${pathname}`
          : message
      throw new OpenCodeError(friendly, {
        status: response.status,
        code: typeof record?._tag === 'string' ? record._tag : undefined,
        details: payload,
      })
    }

    return payload as T
  }

  async info(): Promise<OpenCodeInfo> {
    return this.request<OpenCodeInfo>('/api/info', { timeoutMs: 5_000 })
  }

  async sessions(directory: string, limit = 30): Promise<SessionInfo[]> {
    const payload = await this.request<SessionsResponse>('/api/session', {
      query: {
        directory,
        parentID: 'null',
        archived: 'false',
        order: 'desc',
        limit,
      },
    })
    return Array.isArray(payload?.data) ? payload.data : []
  }

  async session(sessionID: string): Promise<SessionInfo> {
    const payload = await this.request<SessionInfo | { data?: SessionInfo }>(`/api/session/${encodeURIComponent(sessionID)}`)
    const session = (payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload) as SessionInfo | undefined
    if (!session?.id) throw new OpenCodeError(`未找到会话：${sessionID}`, { status: 404 })
    return session
  }

  async messages(sessionID: string, limit = 60): Promise<MessageView[]> {
    // OpenCode's `asc` returns the oldest page. We want the newest page so long
    // sessions still show current turns; callers sort ascending afterwards.
    const payload = await this.request<MessagesResponse>(`/api/session/${encodeURIComponent(sessionID)}/message`, {
      query: { limit, order: 'desc' },
    })
    return normalizeMessages(Array.isArray(payload?.data) ? payload.data : [])
  }

  async createSession(input: { directory: string; title?: string; agent?: string; model?: ModelRef }): Promise<SessionInfo> {
    const payload = await this.request<CreateSessionResponse>('/api/session', {
      method: 'POST',
      body: {
        location: { directory: input.directory },
        ...(input.title ? { title: input.title } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.model ? { model: input.model } : {}),
      },
      timeoutMs: 20_000,
    })
    if (!payload?.data?.id) throw new OpenCodeError('创建会话失败：服务未返回会话 ID')
    return payload.data
  }

  async prompt(sessionID: string, text: string, delivery: 'queue' | 'steer' = 'queue'): Promise<unknown> {
    return this.request(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      method: 'POST',
      body: { text, delivery },
      timeoutMs: 30_000,
    })
  }

  async interrupt(sessionID: string): Promise<unknown> {
    return this.request(`/api/session/${encodeURIComponent(sessionID)}/interrupt`, {
      method: 'POST',
      timeoutMs: 15_000,
    })
  }

  async permissions(sessionID: string): Promise<Record<string, any>[]> {
    const payload = await this.request<{ data?: Record<string, any>[] }>(`/api/session/${encodeURIComponent(sessionID)}/permission`, {
      timeoutMs: 10_000,
    })
    return Array.isArray(payload?.data) ? payload.data : []
  }

  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: 'once' | 'always' | 'reject',
    message?: string,
  ): Promise<unknown> {
    return this.request(`/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, {
      method: 'POST',
      body: { decision, ...(message ? { message } : {}) },
      timeoutMs: 15_000,
    })
  }

  async forms(sessionID: string): Promise<Record<string, any>[]> {
    const payload = await this.request<{ data?: Record<string, any>[] }>(`/api/session/${encodeURIComponent(sessionID)}/form`, {
      timeoutMs: 10_000,
    })
    return Array.isArray(payload?.data) ? payload.data : []
  }

  async replyForm(sessionID: string, formID: string, answer: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}/reply`, {
      method: 'POST',
      body: { answer },
      timeoutMs: 15_000,
    })
  }

  async openEventStream(signal: AbortSignal): Promise<Response> {
    const url = this.buildUrl('/api/event')
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          authorization: this.authHeader(),
          accept: 'text/event-stream',
          'cache-control': 'no-cache',
        },
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw new OpenCodeError('事件流已关闭', { code: 'aborted' })
      throw new OpenCodeError(`无法订阅事件流：${(error as Error).message}`, { code: 'network' })
    }
    if (!response.ok || !response.body) {
      throw new OpenCodeError(`事件流连接失败（HTTP ${response.status}）`, { status: response.status, code: 'sse' })
    }
    return response
  }
}

export async function* readSse(response: Response, signal: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary < 0) break
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const dataLines = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
        if (dataLines.length === 0) continue
        try {
          yield JSON.parse(dataLines.join('\n')) as Record<string, unknown>
        } catch {
          // Ignore malformed SSE frames; OpenCode occasionally emits comments.
        }
      }
    }
  } finally {
    try { await reader.cancel() } catch { /* ignore */ }
  }
}

function truncate(value: string, max = 3_000): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n…（输出已截断）`
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? (value as Record<string, any>) : null
}

function toolOutput(state: Record<string, any>): string {
  const content = state.content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
    if (text) return truncate(stripAnsi(text))
  }
  if (typeof state.output === 'string') return truncate(stripAnsi(state.output))
  if (state.error !== undefined) {
    const error = asRecord(state.error)
    return truncate(stripAnsi(String(error?.message ?? state.error)))
  }
  return ''
}

function normalizeTool(part: Record<string, any>, index: number): ToolCallView | null {
  const state = asRecord(part.state) ?? {}
  const statusRaw = String(state.status ?? '')
  const status: ToolCallView['status'] = statusRaw === 'completed'
    ? 'completed'
    : statusRaw === 'error'
      ? 'error'
      : statusRaw === 'running'
        ? 'running'
        : 'pending'
  const name = String(part.name ?? state.name ?? 'tool')
  const id = String(part.id ?? state.id ?? `${name}-${index}`)
  const title = typeof state.title === 'string' ? state.title : typeof state.metadata?.title === 'string' ? state.metadata.title : undefined
  return {
    id,
    name,
    status,
    title,
    input: state.input,
    output: toolOutput(state) || undefined,
  }
}

export function normalizeMessages(raw: unknown[]): MessageView[] {
  const result: MessageView[] = []
  for (const item of raw) {
    const message = asRecord(item)
    if (!message) continue
    const type = message.type
    if (type !== 'user' && type !== 'assistant') continue
    const created = Number(message.time?.created ?? 0) || 0
    if (type === 'user') {
      result.push({
        id: String(message.id ?? `user-${result.length}`),
        role: 'user',
        created,
        text: stripAnsi(String(message.text ?? '')),
      })
      continue
    }

    const texts: string[] = []
    const reasonings: string[] = []
    const tools: ToolCallView[] = []
    const content = Array.isArray(message.content) ? message.content : []
    content.forEach((part: unknown, index: number) => {
      const record = asRecord(part)
      if (!record) return
      if (record.type === 'text' && typeof record.text === 'string') {
        const text = stripAnsi(record.text).trim()
        if (text) texts.push(text)
      } else if (record.type === 'reasoning' && typeof record.text === 'string') {
        const text = stripAnsi(record.text).trim()
        if (text) reasonings.push(text)
      } else if (record.type === 'tool') {
        const tool = normalizeTool(record, index)
        if (tool) tools.push(tool)
      }
    })

    let error: string | undefined
    if (message.error) {
      const record = asRecord(message.error)
      error = String(record?.message ?? record?._tag ?? message.error)
    }
    if (!texts.length && !reasonings.length && !tools.length && !error) continue

    const model = asRecord(message.model)
    result.push({
      id: String(message.id ?? `assistant-${result.length}`),
      role: 'assistant',
      created,
      text: texts.join('\n\n'),
      reasoning: reasonings.length ? reasonings.join('\n\n') : undefined,
      tools: tools.length ? tools : undefined,
      agent: typeof message.agent === 'string' ? message.agent : undefined,
      model: model && typeof model.id === 'string' && typeof model.providerID === 'string'
        ? { id: model.id, providerID: model.providerID, variant: typeof model.variant === 'string' ? model.variant : undefined }
        : undefined,
      cost: typeof message.cost === 'number' ? message.cost : undefined,
      tokens: asRecord(message.tokens) as TokenInfo | undefined,
      error,
      finish: typeof message.finish === 'string' ? message.finish : undefined,
    })
  }
  return result
}

export function sessionIsBusy(session: SessionInfo | null | undefined): boolean {
  if (!session?.time) return false
  return (session.time.busy ?? 0) > (session.time.idle ?? 0)
}

export function sessionTitle(session: SessionInfo, index = 0): string {
  const title = typeof session.title === 'string' ? session.title.trim() : ''
  if (title) return title
  return `未命名会话 ${index + 1}`
}

export function sessionUpdatedAt(session: SessionInfo): number {
  return session.time?.updated ?? session.time?.busy ?? session.time?.created ?? 0
}
