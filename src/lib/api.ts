import type {
  AgentSummary,
  AutoLoadResult,
  Bootstrap,
  Delivery,
  ProjectInfo,
  SendResponse,
  ServiceInfo,
  SessionInfo,
} from '../../shared/types'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = text }
  }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
    throw new Error(typeof record?.error === 'string' ? record.error : `请求失败（HTTP ${response.status}）`)
  }
  return payload as T
}

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),

  saveConfig: (config: { port: number; autoLoad: boolean; agents: unknown[] }) => request<Bootstrap>('/api/config', {
    method: 'POST',
    body: JSON.stringify(config),
  }),

  discover: () => request<ServiceInfo>('/api/discover', { method: 'POST' }),
  autoLoad: () => request<AutoLoadResult>('/api/auto-load', { method: 'POST' }),
  startService: () => request<ServiceInfo>('/api/service/start', { method: 'POST' }),
  stopService: () => request<ServiceInfo>('/api/service/stop', { method: 'POST' }),

  projects: () => request<ProjectInfo[]>('/api/projects'),

  sessions: (agentId: string) => request<SessionInfo[]>(`/api/agents/${encodeURIComponent(agentId)}/sessions`),

  selectSession: (agentId: string, sessionId: string) => request<AgentSummary>(`/api/agents/${encodeURIComponent(agentId)}/session`, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  }),

  createSession: (agentId: string, title?: string) => request<AgentSummary>(`/api/agents/${encodeURIComponent(agentId)}/session`, {
    method: 'POST',
    body: JSON.stringify({ create: true, title }),
  }),

  prompt: (agentId: string, text: string, delivery: Delivery = 'queue') => request<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/prompt`, {
    method: 'POST',
    body: JSON.stringify({ text, delivery }),
  }),

  interrupt: (agentId: string) => request<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/interrupt`, {
    method: 'POST',
  }),

  sync: (agentId: string) => request<AgentSummary>(`/api/agents/${encodeURIComponent(agentId)}/sync`, {
    method: 'POST',
  }),

  seen: (agentId: string) => request<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/seen`, {
    method: 'POST',
  }),

  follow: (agentId: string, follow: boolean) => request<AgentSummary>(`/api/agents/${encodeURIComponent(agentId)}/follow`, {
    method: 'POST',
    body: JSON.stringify({ follow }),
  }),

  replyPermission: (agentId: string, requestId: string, decision: 'once' | 'always' | 'reject', message?: string) => request<{ ok: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/permission/${encodeURIComponent(requestId)}`,
    { method: 'POST', body: JSON.stringify({ decision, ...(message ? { message } : {}) }) },
  ),

  replyForm: (agentId: string, formId: string, answer: Record<string, unknown>) => request<{ ok: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/form/${encodeURIComponent(formId)}`,
    { method: 'POST', body: JSON.stringify({ answer }) },
  ),

  send: (targets: string[], text: string, delivery: Delivery) => request<SendResponse>('/api/send', {
    method: 'POST',
    body: JSON.stringify({ targets, text, delivery }),
  }),
}
