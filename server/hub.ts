import fs from 'node:fs'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import {
  type AgentConfig,
  type AgentSummary,
  type AgentView,
  type AppConfig,
  type AutoLoadCandidate,
  type AutoLoadResult,
  type Bootstrap,
  type ConnectionInfo,
  type Delivery,
  type DetectedOpenCodeProcess,
  type FormField,
  type InteractionRequest,
  type LiveView,
  type MessageView,
  type PermissionDecision,
  type ProjectInfo,
  type PublicConfig,
  type SendResult,
  type ServiceInfo,
  type SessionInfo,
  type ToolCallView,
} from '../shared/types'
import { loadConfig, publicConfig, sanitizeConfig, saveConfig, slotLabel } from './config'
import { OpenCodeClient, OpenCodeError, sessionIsBusy, sessionUpdatedAt } from './opencode'
import { detectOpenCodeProcesses } from './processes'
import { ServerRegistry, type ServerHandle } from './service'

interface LiveState {
  id: string
  startedAt: number
  active: boolean
  textParts: Map<number, string>
  reasoningParts: Map<number, string>
  tools: Map<string, ToolCallView>
}

interface AgentState {
  cfg: AgentConfig
  index: number
  connection: ConnectionInfo
  session: SessionInfo | null
  messages: MessageView[]
  live: LiveState | null
  busy: boolean
  unread: boolean
  lastSynced?: number
  lastError?: string
  interactions: Map<string, InteractionRequest>
  handleKey?: string
  canonicalDirectory?: string
  knownRoots: Map<string, SessionInfo>
  lastSessionStamp: number
  lastSeenAt: number
  lastAssistantId?: string
  expectingResponse: boolean
  syncing: boolean
  connectPromise?: Promise<void>
  broadcastTimer?: ReturnType<typeof setTimeout>
  autoSelectTimer?: ReturnType<typeof setTimeout>
  messagesDirty: boolean
  timers: Set<ReturnType<typeof setTimeout>>
}

const now = () => Date.now()

function normalizeDir(value: string | undefined | null): string {
  if (!value) return ''
  try {
    let resolved = path.resolve(value)
    if (resolved.length > 1) resolved = resolved.replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    const trimmed = value.trim().replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
  }
}

function errorText(error: unknown): string {
  if (error instanceof OpenCodeError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

function lastAssistant(messages: MessageView[]): MessageView | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index]
  }
  return undefined
}

function shortText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? (value as Record<string, any>) : null
}

function normalizeFormField(value: unknown): FormField | null {
  const field = asRecord(value)
  if (!field || typeof field.key !== 'string') return null
  const type = String(field.type ?? '')
  if (!['string', 'number', 'integer', 'boolean', 'multiselect', 'external'].includes(type)) return null
  const options = Array.isArray(field.options)
    ? field.options
        .map((option: unknown) => asRecord(option))
        .filter((option): option is Record<string, any> => Boolean(option))
        .map((option) => ({
          value: String(option.value ?? ''),
          label: String(option.label ?? option.value ?? ''),
          description: typeof option.description === 'string' ? option.description : undefined,
        }))
    : undefined
  return {
    key: field.key,
    type: type as FormField['type'],
    title: typeof field.title === 'string' ? field.title : undefined,
    description: typeof field.description === 'string' ? field.description : undefined,
    required: Boolean(field.required),
    hidden: Boolean(field.hidden),
    options,
    placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
    default: field.default,
    minLength: typeof field.minLength === 'number' ? field.minLength : undefined,
    maxLength: typeof field.maxLength === 'number' ? field.maxLength : undefined,
    minimum: typeof field.minimum === 'number' ? field.minimum : undefined,
    maximum: typeof field.maximum === 'number' ? field.maximum : undefined,
    url: typeof field.url === 'string' ? field.url : undefined,
  }
}

function permissionInteraction(raw: Record<string, any>, createdAt = Date.now()): InteractionRequest | null {
  if (typeof raw.id !== 'string' || typeof raw.sessionID !== 'string') return null
  const action = typeof raw.action === 'string' ? raw.action : ''
  const resources = Array.isArray(raw.resources) ? raw.resources.map((item: unknown) => String(item)) : []
  return {
    id: raw.id,
    kind: 'permission',
    sessionID: raw.sessionID,
    createdAt,
    title: action ? `请求权限：${action}` : '请求权限',
    description: typeof raw.message === 'string' ? raw.message : resources.join(' · '),
    action,
    resources,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    metadata: asRecord(raw.metadata) ?? undefined,
  }
}

function formInteraction(raw: Record<string, any>, createdAt = Date.now()): InteractionRequest | null {
  if (typeof raw.id !== 'string' || typeof raw.sessionID !== 'string') return null
  const fields = Array.isArray(raw.fields)
    ? raw.fields.map((field: unknown) => normalizeFormField(field)).filter((field): field is FormField => Boolean(field))
    : []
  return {
    id: raw.id,
    kind: 'form',
    sessionID: raw.sessionID,
    createdAt,
    title: typeof raw.title === 'string' ? raw.title : '需要你补充信息',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    fields,
    metadata: asRecord(raw.metadata) ?? undefined,
  }
}

export class Hub {
  root: string
  config: AppConfig
  agents: AgentState[]
  registry: ServerRegistry
  clients = new Set<ServerResponse>()
  serviceInfo: ServiceInfo
  projectsCache: ProjectInfo[] = []
  projectsFetchedAt = 0
  private pollTimer?: ReturnType<typeof setInterval>
  private serviceTimer?: ReturnType<typeof setInterval>
  private polling = false
  private pollTick = 0
  private initialized = false
  private projectLoadPromise?: Promise<ProjectInfo[]>

  constructor(root: string) {
    this.root = root
    this.config = loadConfig(root)
    this.serviceInfo = {
      status: 'offline',
      file: process.env.OPENCODE_SERVICE_FILE || '',
      error: '正在检测共享服务…',
    }
    this.registry = new ServerRegistry({
      onEvent: (handle, event) => this.handleEvent(handle, event),
      onStatus: (handle) => this.handleStatus(handle),
      onService: (service) => this.handleService(service),
      onDedicatedReady: (agentId, port, password) => this.handleDedicatedReady(agentId, port, password),
    })
    this.serviceInfo.file = this.registry.getServiceFile()
    this.agents = this.config.agents.map((cfg, index) => this.createAgent(cfg, index))
  }

  private createAgent(cfg: AgentConfig, index: number): AgentState {
    return {
      cfg,
      index,
      connection: { status: 'offline', mode: cfg.mode },
      session: null,
      messages: [],
      live: null,
      busy: false,
      unread: false,
      interactions: new Map(),
      knownRoots: new Map(),
      lastSessionStamp: 0,
      lastSeenAt: now(),
      expectingResponse: false,
      syncing: false,
      messagesDirty: false,
      timers: new Set(),
    }
  }

  async initialize(): Promise<void> {
    this.serviceInfo = await this.registry.discover().catch((error): ServiceInfo => ({
      status: 'offline',
      file: this.registry.getServiceFile(),
      error: errorText(error),
    }))
    this.pollTimer = setInterval(() => { void this.poll() }, 8_000)
    this.serviceTimer = setInterval(() => { void this.refreshService() }, 20_000)
    if (this.serviceInfo.status === 'online') await this.loadProjectsFromService()
    this.initialized = true
    if (this.config.autoLoad && this.agents.some((agent) => !agent.cfg.directory.trim())) {
      try {
        const result = await this.autoLoad()
        if (result.applied.length > 0) {
          console.log(`[auto-load] ${result.applied.map((item) => `${item.slotId}=${item.directory}`).join(', ')}`)
        }
      } catch (error) {
        console.warn('[auto-load] 自动检测失败：', errorText(error))
      }
    }
    void this.connectAll()
  }

  shutdown(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.serviceTimer) clearInterval(this.serviceTimer)
    for (const agent of this.agents) {
      for (const timer of agent.timers) clearTimeout(timer)
      if (agent.broadcastTimer) clearTimeout(agent.broadcastTimer)
      if (agent.autoSelectTimer) clearTimeout(agent.autoSelectTimer)
    }
    void this.registry.stopAll()
    for (const client of this.clients) {
      try { client.end() } catch { /* ignore */ }
    }
    this.clients.clear()
  }

  bootstrap(): Bootstrap {
    return {
      config: publicConfig(this.config),
      service: this.serviceInfo,
      agents: this.agents.map((agent) => this.serialize(agent, true)),
      projects: this.projectsCache,
      now: now(),
    }
  }

  addClient(response: ServerResponse): void {
    this.clients.add(response)
    this.send(response, { type: 'snapshot', data: this.bootstrap() })
    const heartbeat = setInterval(() => {
      try { response.write(': ping\n\n') } catch { /* ignore */ }
    }, 15_000)
    response.on('close', () => {
      clearInterval(heartbeat)
      this.clients.delete(response)
    })
  }

  private send(response: ServerResponse, event: unknown): void {
    try {
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      this.clients.delete(response)
    }
  }

  private broadcast(event: unknown): void {
    for (const client of this.clients) this.send(client, event)
  }

  private broadcastSnapshot(): void {
    this.broadcast({ type: 'snapshot', data: this.bootstrap() })
  }

  notice(level: 'info' | 'success' | 'error', message: string): void {
    this.broadcast({ type: 'notice', data: { level, message } })
  }

  private serializeLive(agent: AgentState): LiveView | null {
    const live = agent.live
    if (!live) return null
    const text = [...live.textParts.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join('')
    const reasoning = [...live.reasoningParts.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join('')
    if (!live.active && !text && !reasoning && live.tools.size === 0) return null
    return {
      id: live.id,
      text,
      reasoning: reasoning || undefined,
      tools: live.tools.size ? [...live.tools.values()] : undefined,
      startedAt: live.startedAt,
      active: live.active,
    }
  }

  private serialize(agent: AgentState, withMessages: boolean): AgentView {
    const handle = this.registry.listHandles().find((candidate) => candidate.key === agent.handleKey)
    const connection: ConnectionInfo = {
      ...agent.connection,
      mode: agent.cfg.mode,
      sse: handle?.sseStatus ?? agent.connection.sse ?? 'offline',
      managed: handle?.managed ?? agent.connection.managed,
      version: handle?.version ?? agent.connection.version,
      url: handle?.url ?? agent.connection.url,
    }
    const base: AgentView = {
      id: agent.cfg.id,
      label: slotLabel(agent.cfg, agent.index),
      directory: agent.cfg.directory,
      mode: agent.cfg.mode,
      follow: agent.cfg.follow,
      configured: Boolean(agent.cfg.directory.trim()),
      connection,
      session: agent.session,
      busy: agent.busy,
      unread: agent.unread,
      live: this.serializeLive(agent),
      messages: withMessages ? agent.messages : [],
      interactions: [...agent.interactions.values()].sort((a, b) => a.createdAt - b.createdAt),
      lastSynced: agent.lastSynced,
      lastError: agent.lastError,
    }
    return base
  }

  private summary(agent: AgentState): AgentSummary {
    const { messages: _messages, ...summary } = this.serialize(agent, false)
    return summary
  }

  private scheduleBroadcast(agent: AgentState, options: { messages?: boolean; immediate?: boolean } = {}): void {
    if (options.messages) agent.messagesDirty = true
    const flush = () => {
      agent.broadcastTimer = undefined
      this.broadcast({ type: 'agent', data: this.summary(agent) })
      if (agent.messagesDirty) {
        agent.messagesDirty = false
        this.broadcast({ type: 'messages', data: { agentId: agent.cfg.id, messages: agent.messages } })
      }
    }
    if (agent.broadcastTimer) clearTimeout(agent.broadcastTimer)
    if (options.immediate) {
      flush()
      return
    }
    agent.broadcastTimer = setTimeout(flush, 80)
  }

  private later(agent: AgentState, delay: number, callback: () => void): void {
    const timer = setTimeout(() => {
      agent.timers.delete(timer)
      callback()
    }, delay)
    agent.timers.add(timer)
  }

  private findAgent(id: string): AgentState {
    const agent = this.agents.find((candidate) => candidate.cfg.id === id)
    if (!agent) throw new OpenCodeError(`未找到槽位：${id}`)
    return agent
  }

  private async resolveHandle(agent: AgentState): Promise<ServerHandle> {
    if (agent.cfg.mode === 'shared') return this.registry.getShared()
    if (agent.cfg.mode === 'manual') return this.registry.getManual(agent.cfg)
    return this.registry.getDedicated(agent.cfg)
  }

  private async connectAll(): Promise<void> {
    const configured = this.agents.filter((agent) => agent.cfg.directory.trim())
    await Promise.allSettled(configured.map((agent) => this.connectAgent(agent)))
    const keys = new Set(this.agents.map((agent) => agent.handleKey).filter((key): key is string => Boolean(key)))
    await this.registry.retain(keys)
  }

  async connectAgent(agent: AgentState): Promise<void> {
    if (agent.connectPromise) return agent.connectPromise
    if (!agent.cfg.directory.trim()) {
      agent.connection = { status: 'offline', mode: agent.cfg.mode }
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }
    agent.connection = {
      ...agent.connection,
      status: 'connecting',
      mode: agent.cfg.mode,
      error: undefined,
    }
    this.scheduleBroadcast(agent, { immediate: true })
    agent.connectPromise = (async () => {
      try {
        const handle = await this.resolveHandle(agent)
        agent.handleKey = handle.key
        agent.connection = {
          status: 'online',
          mode: agent.cfg.mode,
          url: handle.url,
          version: handle.version,
          managed: handle.managed,
          sse: handle.sseStatus,
        }
        agent.lastError = undefined
        await this.resolveCanonical(agent, handle)
        await this.syncAgent(agent, { forceMessages: true, handle })
      } catch (error) {
        agent.connection = {
          ...agent.connection,
          status: 'error',
          error: errorText(error),
        }
        agent.lastError = errorText(error)
        this.scheduleBroadcast(agent, { immediate: true })
      } finally {
        agent.connectPromise = undefined
      }
    })()
    return agent.connectPromise
  }

  private async resolveCanonical(agent: AgentState, handle: ServerHandle): Promise<void> {
    const projects = await this.getProjects(handle)
    const target = normalizeDir(agent.cfg.directory)
    const match = projects.find((project) => normalizeDir(project.canonical) === target)
    agent.canonicalDirectory = match?.canonical ?? agent.cfg.directory
  }

  private async getProjects(handle: ServerHandle, force = false): Promise<ProjectInfo[]> {
    if (!force && this.projectsFetchedAt && now() - this.projectsFetchedAt < 15_000) return this.projectsCache
    try {
      const raw = await handle.client.request<ProjectInfo[] | { data?: ProjectInfo[] }>('/api/project', { timeoutMs: 10_000 })
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : []
      const seen = new Set<string>()
      const normalized = list
        .filter((project) => project && typeof project.canonical === 'string')
        .filter((project) => project.id !== 'global')
        .filter((project) => {
          try { return fs.existsSync(project.canonical) } catch { return false }
        })
        .filter((project) => {
          const key = normalizeDir(project.canonical)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((project) => ({
          ...project,
          lastActive: project.time?.active ?? project.time?.updated ?? project.time?.created ?? 0,
        }))
        .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))
      this.projectsFetchedAt = now()
      if (JSON.stringify(normalized) !== JSON.stringify(this.projectsCache)) {
        this.projectsCache = normalized
        this.broadcast({ type: 'projects', data: normalized })
      }
    } catch {
      // A project list failure should not block session monitoring.
    }
    return this.projectsCache
  }

  async refreshProjects(): Promise<ProjectInfo[]> {
    const agent = this.agents.find((candidate) => candidate.handleKey && candidate.connection.status === 'online')
    if (!agent) return this.projectsCache
    try {
      const handle = await this.resolveHandle(agent)
      return this.getProjects(handle, true)
    } catch {
      return this.projectsCache
    }
  }

  /**
   * Find running OpenCode TUIs and fill empty slots with their projects.
   * Explicit command-line directories win; otherwise the most recently active
   * projects from the shared service are used (one per detected TUI, up to 4).
   */
  async autoLoad(): Promise<AutoLoadResult> {
    let detected: DetectedOpenCodeProcess[] = []
    let detectionError: string | undefined
    try {
      detected = await detectOpenCodeProcesses()
    } catch (error) {
      detectionError = errorText(error)
    }

    const tui = detected.filter((process) => process.kind === 'tui')
    const standaloneCount = tui.filter((process) => process.transport === 'standalone').length
    const emptySlots = this.agents.filter((agent) => !agent.cfg.directory.trim())
    const configured = new Set(
      this.config.agents
        .map((agent) => normalizeDir(agent.directory))
        .filter(Boolean),
    )

    if (tui.length === 0) {
      const hasServe = detected.some((process) => process.kind === 'serve')
      return {
        detected,
        candidates: [],
        applied: [],
        message: detectionError
          ? `检测 OpenCode 进程失败：${detectionError}`
          : hasServe
            ? '检测到 OpenCode 服务进程，但没有打开的 TUI 窗口。先打开一个 OpenCode 项目，或手动选择目录。'
            : '没有检测到正在运行的 OpenCode TUI 进程。先打开一个 OpenCode 项目，或手动选择目录。',
      }
    }
    if (emptySlots.length === 0) {
      return { detected, candidates: [], applied: [], message: '4 个槽位都已配置，未做改动。' }
    }

    const projects = this.serviceInfo.status === 'online'
      ? await this.loadProjectsFromService()
      : this.projectsCache
    const candidates = new Map<string, AutoLoadCandidate>()
    const addCandidate = (directory: string, label: string, source: AutoLoadCandidate['source']) => {
      const trimmed = directory.trim()
      if (!trimmed || !fs.existsSync(trimmed)) return
      const key = normalizeDir(trimmed)
      if (!key || configured.has(key) || candidates.has(key)) return
      candidates.set(key, {
        directory: path.resolve(trimmed),
        label: (label.trim() || path.basename(trimmed)).slice(0, 80),
        source,
      })
    }
    const projectFor = (directory: string) => projects.find((project) => normalizeDir(project.canonical) === normalizeDir(directory))
    const explicitDirectories = tui
      .map((process) => process.directory)
      .filter((directory): directory is string => Boolean(directory))

    if (explicitDirectories.length > 0) {
      for (const directory of explicitDirectories) {
        const project = projectFor(directory)
        addCandidate(directory, project?.name || path.basename(directory), 'process')
      }
    } else {
      const recent = projects.slice(0, Math.min(tui.length, 4))
      for (const project of recent) {
        addCandidate(project.canonical, project.name || path.basename(project.canonical), 'recent')
      }
    }

    const list = [...candidates.values()].slice(0, emptySlots.length)
    if (list.length === 0) {
      return {
        detected,
        candidates: [],
        applied: [],
        message: projects.length === 0
          ? `检测到 ${tui.length} 个 OpenCode TUI，但共享服务没有返回可用的项目目录。请手动选择项目。`
          : `检测到 ${tui.length} 个 OpenCode TUI，但对应项目已在槽位中或目录不可用。`,
      }
    }

    const applied: AutoLoadResult['applied'] = []
    for (let index = 0; index < list.length; index += 1) {
      const candidate = list[index]!
      const slot = emptySlots[index]
      if (!slot) break
      const previous = this.agents[slot.index]!
      for (const timer of previous.timers) clearTimeout(timer)
      if (previous.broadcastTimer) clearTimeout(previous.broadcastTimer)
      if (previous.autoSelectTimer) clearTimeout(previous.autoSelectTimer)
      const cfg: AgentConfig = {
        ...previous.cfg,
        directory: candidate.directory,
        label: candidate.label,
        mode: 'shared',
        follow: true,
        serverUrl: undefined,
        password: undefined,
        sessionId: undefined,
        dedicatedPort: undefined,
        dedicatedPassword: undefined,
      }
      this.config.agents[slot.index] = cfg
      this.agents[slot.index] = this.createAgent(cfg, slot.index)
      applied.push({ slotId: cfg.id, directory: cfg.directory, label: cfg.label })
    }

    if (applied.length > 0) {
      saveConfig(this.root, this.config)
      this.broadcastSnapshot()
      void this.connectAll()
      this.notice('success', `已自动加载 ${applied.length} 个正在运行的 OpenCode 项目`)
    }

    const source = explicitDirectories.length > 0 ? '进程参数' : '最近活跃项目'
    const standaloneNote = standaloneCount > 0 ? '；--standalone 实例将使用共享会话轮询，实时流可能不完整' : ''
    return {
      detected,
      candidates: list,
      applied,
      message: applied.length > 0
        ? `已自动加载 ${applied.length} 个项目（来源：${source}${standaloneNote}）`
        : '检测到 OpenCode TUI，但项目已在槽位中或目录不可用。',
    }
  }

  private async loadProjectsFromService(): Promise<ProjectInfo[]> {
    if (this.projectLoadPromise) return this.projectLoadPromise
    this.projectLoadPromise = (async () => {
      try {
        const handle = await this.registry.getShared()
        return await this.getProjects(handle, true)
      } catch {
        return this.projectsCache
      } finally {
        this.projectLoadPromise = undefined
      }
    })()
    return this.projectLoadPromise
  }

  private directoryMatches(agent: AgentState, directory: string | undefined): boolean {
    if (!directory || !agent.cfg.directory) return false
    return normalizeDir(directory) === normalizeDir(agent.canonicalDirectory ?? agent.cfg.directory)
  }

  private async syncAgent(agent: AgentState, options: { forceMessages?: boolean; handle?: ServerHandle } = {}): Promise<void> {
    if (agent.syncing) return
    if (!agent.cfg.directory.trim()) return
    agent.syncing = true
    try {
      const handle = options.handle ?? await this.resolveHandle(agent)
      agent.handleKey = handle.key
      const directory = agent.canonicalDirectory ?? agent.cfg.directory
      const sessions = await handle.client.sessions(directory, 30)
      const roots = sessions.filter((session) => !session.parentID)
      agent.knownRoots = new Map(roots.map((session) => [session.id, session]))
      const sorted = [...roots].sort((a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a))

      let target: SessionInfo | null = null
      if (agent.cfg.follow) {
        target = sorted[0] ?? null
      } else if (agent.cfg.sessionId) {
        target = sorted.find((session) => session.id === agent.cfg.sessionId) ?? null
        if (!target) {
          try {
            target = await handle.client.session(agent.cfg.sessionId)
          } catch {
            target = null
            agent.cfg.sessionId = undefined
            this.persist()
          }
        }
      }
      if (!target && !agent.cfg.follow) target = sorted[0] ?? null

      if (!target) {
        const hadSession = Boolean(agent.session)
        agent.session = null
        agent.messages = []
        agent.live = null
        agent.busy = false
        agent.unread = false
        agent.lastSessionStamp = 0
        agent.lastAssistantId = undefined
        agent.connection = { ...agent.connection, status: 'online', mode: agent.cfg.mode, url: handle.url, version: handle.version, managed: handle.managed, sse: handle.sseStatus }
        agent.lastSynced = now()
        agent.lastError = undefined
        agent.messagesDirty = true
        if (hadSession) this.scheduleBroadcast(agent, { messages: true, immediate: true })
        else this.scheduleBroadcast(agent)
        return
      }

      if (!agent.session || agent.session.id !== target.id) {
        await this.loadSession(agent, handle, target, { explicit: false })
        return
      }

      const previousStamp = agent.lastSessionStamp
      const remoteStamp = sessionUpdatedAt(target)
      const changed = remoteStamp > previousStamp
      const wasBusy = agent.busy
      const remoteBusy = sessionIsBusy(target)
      agent.session = target
      agent.busy = remoteBusy || Boolean(agent.live?.active)
      // Fetch whenever the session advanced, including while a turn is running:
      // standalone TUIs have no shared SSE, so polling is the only source of
      // new messages. Only advance the stamp after a successful fetch.
      const shouldFetch = Boolean(options.forceMessages)
        || agent.messages.length === 0
        || changed
        || (wasBusy && !agent.busy)
        || Boolean(agent.live && !agent.live.active)

      agent.connection = { ...agent.connection, status: 'online', mode: agent.cfg.mode, url: handle.url, version: handle.version, managed: handle.managed, sse: handle.sseStatus }
      agent.lastSynced = now()
      agent.lastError = undefined

      if (shouldFetch) {
        const messages = await handle.client.messages(target.id, 60)
        this.applyMessages(agent, messages)
      }
      agent.lastSessionStamp = Math.max(previousStamp, remoteStamp)
      this.scheduleBroadcast(agent)
    } catch (error) {
      agent.lastError = errorText(error)
      agent.connection = {
        ...agent.connection,
        status: 'error',
        error: errorText(error),
      }
      this.scheduleBroadcast(agent, { immediate: true })
    } finally {
      agent.syncing = false
    }
  }

  private applyMessages(agent: AgentState, messages: MessageView[], initial = false): void {
    const pendingOptimistic = agent.messages.filter((message) => message.optimistic)
      .filter((optimistic) => !messages.some((incoming) => incoming.role === 'user' && incoming.text === optimistic.text))
    const merged = [...messages, ...pendingOptimistic]
      .sort((a, b) => a.created - b.created)
      .slice(-60)
    agent.messages = merged

    const assistant = lastAssistant(merged)
    if (assistant && assistant.id !== agent.lastAssistantId) {
      if (!initial && !agent.busy) {
        if (agent.expectingResponse) {
          agent.unread = false
          agent.lastSeenAt = Math.max(agent.lastSeenAt, assistant.created)
        } else if (assistant.created > agent.lastSeenAt) {
          agent.unread = true
        }
      }
      agent.lastAssistantId = assistant.id
    }

    if (agent.live && merged.some((message) => message.id === agent.live?.id)) {
      if (!agent.busy || !agent.live.active) agent.live = null
    }
    agent.messagesDirty = true
    this.scheduleBroadcast(agent, { messages: true })
  }

  private async loadSession(agent: AgentState, handle: ServerHandle, session: SessionInfo, options: { explicit: boolean }): Promise<void> {
    agent.session = session
    agent.messages = []
    agent.live = null
    agent.busy = sessionIsBusy(session)
    agent.unread = false
    agent.lastSessionStamp = sessionUpdatedAt(session)
    agent.lastAssistantId = undefined
    agent.lastSeenAt = now()
    agent.interactions.clear()
    agent.expectingResponse = false
    agent.messagesDirty = true
    this.scheduleBroadcast(agent, { messages: true })
    try {
      const messages = await handle.client.messages(session.id, 60)
      this.applyMessages(agent, messages, true)
      agent.lastError = undefined
    } catch (error) {
      agent.lastError = errorText(error)
      this.scheduleBroadcast(agent, { immediate: true })
    }
    if (options.explicit) {
      agent.cfg.follow = false
      agent.cfg.sessionId = session.id
      this.persist()
      this.broadcast({ type: 'config', data: publicConfig(this.config) })
    }
    void this.refreshInteractions(agent, handle, session.id)
  }

  private async refreshInteractions(agent: AgentState, handle: ServerHandle, sessionID: string): Promise<void> {
    try {
      const [permissions, forms] = await Promise.all([
        handle.client.permissions(sessionID),
        handle.client.forms(sessionID),
      ])
      if (agent.session?.id !== sessionID) return
      const next = new Map<string, InteractionRequest>()
      for (const permission of permissions) {
        const interaction = permissionInteraction(permission)
        if (interaction) next.set(interaction.id, interaction)
      }
      for (const form of forms) {
        const interaction = formInteraction(form)
        if (interaction) next.set(interaction.id, interaction)
      }
      // Keep event-sourced records that may not be visible through the REST snapshot yet.
      for (const [id, interaction] of agent.interactions) {
        if (!next.has(id)) next.set(id, interaction)
      }
      agent.interactions = next
      this.scheduleBroadcast(agent, { immediate: true })
    } catch {
      // Older servers or restricted sessions may not expose these endpoints.
    }
  }

  private handleDedicatedReady(agentId: string, port: number, password: string): void {
    const cfg = this.config.agents.find((candidate) => candidate.id === agentId)
    if (!cfg) return
    cfg.dedicatedPort = port
    cfg.dedicatedPassword = password
    this.persist()
    this.broadcast({ type: 'config', data: publicConfig(this.config) })
  }

  private persist(): void {
    try {
      saveConfig(this.root, this.config)
    } catch (error) {
      console.warn('[config] 保存失败：', errorText(error))
      this.notice('error', `配置保存失败：${errorText(error)}`)
    }
  }

  private handleStatus(handle: ServerHandle): void {
    for (const agent of this.agents) {
      if (agent.handleKey !== handle.key) continue
      const status: ConnectionInfo['status'] = handle.status === 'starting'
        ? 'connecting'
        : handle.status === 'error'
          ? 'error'
          : handle.status
      agent.connection = {
        ...agent.connection,
        status,
        mode: agent.cfg.mode,
        url: handle.url,
        version: handle.version,
        managed: handle.managed,
        sse: handle.sseStatus,
        error: handle.error,
      }
      if (status === 'offline') agent.busy = false
      this.scheduleBroadcast(agent)
    }
  }

  private handleService(service: ServiceInfo): void {
    const changed = JSON.stringify(service) !== JSON.stringify(this.serviceInfo)
    this.serviceInfo = service
    if (changed) this.broadcast({ type: 'service', data: service })
    if (!this.initialized) return
    if (service.status === 'online') {
      void this.loadProjectsFromService()
      for (const agent of this.agents) {
        if (agent.cfg.mode === 'shared' && agent.cfg.directory && agent.connection.status !== 'online' && !agent.connectPromise) {
          void this.connectAgent(agent)
        }
      }
    } else if (service.status === 'offline') {
      for (const agent of this.agents) {
        if (agent.cfg.mode === 'shared' && (agent.connection.status === 'online' || agent.connection.status === 'connecting')) {
          agent.connection = { ...agent.connection, status: 'offline', error: service.error }
          this.scheduleBroadcast(agent, { immediate: true })
        }
      }
    }
  }

  private handleEvent(handle: ServerHandle, event: Record<string, any>): void {
    const type = typeof event.type === 'string' ? event.type : ''
    if (!type || type === 'server.connected') return
    const data = (event.data && typeof event.data === 'object' ? event.data : {}) as Record<string, any>
    const sessionID = typeof data.sessionID === 'string'
      ? data.sessionID
      : typeof data.permission?.sessionID === 'string'
        ? data.permission.sessionID
        : typeof data.form?.sessionID === 'string'
          ? data.form.sessionID
          : typeof event.sessionID === 'string'
            ? event.sessionID
            : undefined
    const directory = typeof event.location?.directory === 'string'
      ? event.location.directory
      : typeof data.location?.directory === 'string'
        ? data.location.directory
        : undefined

    for (const agent of this.agents) {
      if (agent.handleKey !== handle.key) continue
      this.handleAgentEvent(agent, handle, type, data, sessionID, directory, event)
    }
  }

  private handleAgentEvent(
    agent: AgentState,
    handle: ServerHandle,
    type: string,
    data: Record<string, any>,
    sessionID: string | undefined,
    directory: string | undefined,
    event: Record<string, any>,
  ): void {
    if (type === 'session.created' && sessionID) {
      if (!data.parentID) {
        const known = agent.knownRoots.get(sessionID)
        if (!known) {
          agent.knownRoots.set(sessionID, {
            id: sessionID,
            parentID: undefined,
            title: typeof data.title === 'string' ? data.title : undefined,
            time: { created: Number(event.created ?? now()) },
            location: directory ? { directory } : undefined,
          })
        }
        if (agent.cfg.follow && this.directoryMatches(agent, directory)) {
          this.scheduleAutoSelect(agent, sessionID)
        }
      }
      return
    }

    if (!sessionID) return

    if (type === 'session.deleted' && agent.session?.id === sessionID) {
      agent.session = null
      agent.messages = []
      agent.live = null
      agent.busy = false
      agent.unread = false
      agent.interactions.clear()
      this.scheduleBroadcast(agent, { messages: true, immediate: true })
      return
    }

    if (agent.session?.id !== sessionID) {
      if (
        agent.cfg.follow
        && agent.knownRoots.has(sessionID)
        && this.directoryMatches(agent, directory)
        && (type === 'session.execution.started' || type.startsWith('session.text.'))
      ) {
        this.scheduleAutoSelect(agent, sessionID)
      }
      return
    }

    if (type === 'session.renamed') {
      if (typeof data.title === 'string') agent.session = { ...agent.session, title: data.title }
      this.scheduleBroadcast(agent)
      return
    }

    if (type === 'session.model.selected' || type === 'session.agent.selected') {
      this.scheduleBroadcast(agent)
      return
    }

    if (type === 'permission.asked') {
      if (!sessionID || sessionID !== agent.session?.id) return
      const permission = asRecord(data.permission) ?? data
      const interaction = permissionInteraction(
        permission.sessionID ? permission : { ...permission, sessionID },
        Number(event.created ?? now()),
      )
      if (interaction) {
        agent.interactions.set(interaction.id, interaction)
        this.notice('error', `${slotLabel(agent.cfg, agent.index)} 需要你处理：${interaction.title}`)
        this.scheduleBroadcast(agent, { immediate: true })
      }
      return
    }
    if (type === 'permission.replied') {
      const requestID = [data.requestID, data.id, data.permission?.requestID, data.permission?.id]
        .find((value): value is string => typeof value === 'string') ?? ''
      if (requestID) agent.interactions.delete(requestID)
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }

    if (type === 'form.created') {
      if (!sessionID || sessionID !== agent.session?.id) return
      const form = asRecord(data.form) ?? data
      const interaction = formInteraction(
        form.sessionID ? form : { ...form, sessionID },
        Number(event.created ?? now()),
      )
      if (interaction) {
        agent.interactions.set(interaction.id, interaction)
        this.notice('error', `${slotLabel(agent.cfg, agent.index)} 需要你填写：${interaction.title}`)
        this.scheduleBroadcast(agent, { immediate: true })
      }
      return
    }
    if (type === 'form.replied' || type === 'form.cancelled') {
      const formID = [data.id, data.formID, data.form?.id]
        .find((value): value is string => typeof value === 'string') ?? ''
      if (formID) agent.interactions.delete(formID)
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }

    if (type.startsWith('session.text.') || type.startsWith('session.reasoning.')) {
      const messageID = String(data.assistantMessageID ?? `live-${sessionID}`)
      this.ensureLive(agent, messageID)
      const live = agent.live!
      const ordinal = Number.isFinite(Number(data.ordinal)) ? Number(data.ordinal) : 0
      const isReasoning = type.startsWith('session.reasoning.')
      const parts = isReasoning ? live.reasoningParts : live.textParts
      if (type.endsWith('.started')) {
        parts.set(ordinal, '')
      } else if (type.endsWith('.delta')) {
        const delta = typeof data.delta === 'string' ? data.delta : ''
        parts.set(ordinal, `${parts.get(ordinal) ?? ''}${delta}`)
      } else if (type.endsWith('.ended')) {
        const full = typeof data.text === 'string' ? data.text : (parts.get(ordinal) ?? '')
        parts.set(ordinal, full)
      }
      live.active = true
      agent.busy = true
      this.scheduleBroadcast(agent)
      return
    }

    if (type.startsWith('session.tool.')) {
      const messageID = String(data.assistantMessageID ?? `live-${sessionID}`)
      this.ensureLive(agent, messageID)
      const live = agent.live!
      const name = String(data.name ?? data.toolName ?? data.tool?.name ?? 'tool')
      const id = String(data.toolID ?? data.callID ?? data.id ?? data.tool?.id ?? `${name}-${now()}`)
      const status: ToolCallView['status'] = type.endsWith('.failed')
        ? 'error'
        : type.endsWith('.success')
          ? 'completed'
          : type.endsWith('.called')
            ? 'running'
            : 'running'
      const previous = live.tools.get(id)
      live.tools.set(id, {
        id,
        name,
        status,
        input: data.input ?? previous?.input,
        output: shortText(data.output ?? data.content ?? data.error?.message ?? previous?.output),
        title: typeof data.title === 'string' ? data.title : previous?.title,
      })
      live.active = true
      agent.busy = true
      this.scheduleBroadcast(agent)
      this.later(agent, 900, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
      return
    }

    if (type === 'session.execution.started') {
      agent.busy = true
      if (agent.live && !agent.live.active) agent.live = null
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }

    if (type === 'session.execution.succeeded') {
      agent.busy = false
      if (agent.live) agent.live.active = false
      agent.lastError = undefined
      this.later(agent, 260, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }

    if (type === 'session.execution.failed') {
      agent.busy = false
      if (agent.live) agent.live.active = false
      agent.lastError = String(data.error?.message ?? data.error ?? '执行失败')
      this.later(agent, 260, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }

    if (type === 'session.execution.interrupted') {
      agent.busy = false
      if (agent.live) agent.live.active = false
      this.later(agent, 260, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }

    if (type === 'session.idle') {
      agent.busy = false
      if (agent.live) agent.live.active = false
      const wasOwnResponse = agent.expectingResponse
      agent.expectingResponse = false
      agent.unread = wasOwnResponse ? false : true
      if (wasOwnResponse) agent.lastSeenAt = now()
      this.later(agent, 300, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
      this.scheduleBroadcast(agent, { immediate: true })
      return
    }

    if (type === 'session.status') {
      if (data.status === 'busy' || data.status === 'working') agent.busy = true
      if (data.status === 'idle' || data.status === 'ready') {
        agent.busy = false
        if (agent.live) agent.live.active = false
      }
      this.scheduleBroadcast(agent)
    }
  }

  private ensureLive(agent: AgentState, messageID: string): void {
    if (agent.live?.id === messageID) return
    agent.live = {
      id: messageID,
      startedAt: now(),
      active: true,
      textParts: new Map(),
      reasoningParts: new Map(),
      tools: new Map(),
    }
  }

  private scheduleAutoSelect(agent: AgentState, sessionID: string): void {
    if (agent.session?.id === sessionID) return
    if (!agent.cfg.follow) return
    if (agent.autoSelectTimer) clearTimeout(agent.autoSelectTimer)
    agent.autoSelectTimer = setTimeout(() => {
      agent.autoSelectTimer = undefined
      void (async () => {
        if (!agent.cfg.follow || agent.session?.id === sessionID) return
        try {
          const handle = await this.resolveHandle(agent)
          if (agent.handleKey !== handle.key) return
          const session = await handle.client.session(sessionID)
          if (!agent.cfg.follow || agent.session?.id === session.id) return
          await this.loadSession(agent, handle, session, { explicit: false })
          this.scheduleBroadcast(agent, { messages: true, immediate: true })
        } catch {
          // The polling loop will reconcile if this transient lookup fails.
        }
      })()
    }, 300)
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    this.pollTick += 1
    try {
      const tasks: Promise<void>[] = []
      for (const agent of this.agents) {
        if (!agent.cfg.directory) continue
        if (agent.connection.status === 'online') {
          tasks.push(this.syncAgent(agent))
        } else if (agent.cfg.mode === 'shared' && agent.connection.status !== 'connecting' && this.pollTick % 4 === 0) {
          tasks.push(this.connectAgent(agent))
        }
      }
      await Promise.allSettled(tasks)
    } finally {
      this.polling = false
    }
  }

  private async refreshService(): Promise<void> {
    try {
      const service = await this.registry.discover(true)
      this.serviceInfo = service
      if (service.status === 'online') {
        for (const agent of this.agents) {
          if (agent.cfg.mode === 'shared' && agent.cfg.directory && agent.connection.status !== 'online' && !agent.connectPromise) {
            void this.connectAgent(agent)
          }
        }
      }
    } catch {
      // Discovery failures are surfaced through serviceInfo on the next attempt.
    }
  }

  async updateConfig(input: unknown): Promise<Bootstrap> {
    const next = sanitizeConfig(input, this.config)
    const previous = this.config
    this.config = next
    this.persist()
    const changedAgents = next.agents.some((agent, index) => {
      const old = previous.agents[index]
      return !old || old.mode !== agent.mode || old.directory !== agent.directory || old.serverUrl !== agent.serverUrl
    })
    if (changedAgents) {
      await this.registry.retain(new Set())
    }
    this.agents = next.agents.map((cfg, index) => this.createAgent(cfg, index))
    this.broadcastSnapshot()
    void this.connectAll()
    return this.bootstrap()
  }

  async discoverService(): Promise<ServiceInfo> {
    const service = await this.registry.discover(true)
    this.serviceInfo = service
    this.broadcast({ type: 'service', data: service })
    if (service.status === 'online') {
      for (const agent of this.agents) {
        if (agent.cfg.mode === 'shared' && agent.cfg.directory && agent.connection.status !== 'online') {
          void this.connectAgent(agent)
        }
      }
    }
    return service
  }

  async startSharedService(): Promise<ServiceInfo> {
    const service = await this.registry.startSharedService()
    this.serviceInfo = service
    this.broadcast({ type: 'service', data: service })
    for (const agent of this.agents) {
      if (agent.cfg.mode === 'shared' && agent.cfg.directory) void this.connectAgent(agent)
    }
    return service
  }

  async stopSharedService(): Promise<ServiceInfo> {
    const service = await this.registry.stopSharedService()
    this.serviceInfo = service
    this.broadcast({ type: 'service', data: service })
    for (const agent of this.agents) {
      if (agent.cfg.mode === 'shared') {
        agent.connection = { ...agent.connection, status: 'offline', error: '共享服务已停止' }
        agent.busy = false
        this.scheduleBroadcast(agent, { immediate: true })
      }
    }
    return service
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const projects = await this.refreshProjects()
    if (projects.length > 0) return projects
    return this.loadProjectsFromService()
  }

  async listSessions(agentID: string): Promise<SessionInfo[]> {
    const agent = this.findAgent(agentID)
    if (!agent.cfg.directory) return []
    const handle = await this.resolveHandle(agent)
    const sessions = await handle.client.sessions(agent.canonicalDirectory ?? agent.cfg.directory, 40)
    return sessions
      .filter((session) => !session.parentID)
      .sort((a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a))
  }

  async selectSession(agentID: string, sessionID: string): Promise<AgentSummary> {
    const agent = this.findAgent(agentID)
    const handle = await this.resolveHandle(agent)
    const session = await handle.client.session(sessionID)
    agent.cfg.follow = false
    agent.cfg.sessionId = session.id
    this.persist()
    this.broadcast({ type: 'config', data: publicConfig(this.config) })
    await this.loadSession(agent, handle, session, { explicit: false })
    this.scheduleBroadcast(agent, { messages: true, immediate: true })
    return this.summary(agent)
  }

  async createSession(agentID: string, title?: string): Promise<AgentSummary> {
    const agent = this.findAgent(agentID)
    if (!agent.cfg.directory) throw new OpenCodeError('请先配置项目目录')
    const handle = await this.resolveHandle(agent)
    const session = await handle.client.createSession({
      directory: agent.canonicalDirectory ?? agent.cfg.directory,
      title: title?.trim() || undefined,
    })
    agent.cfg.follow = false
    agent.cfg.sessionId = session.id
    this.persist()
    this.broadcast({ type: 'config', data: publicConfig(this.config) })
    await this.loadSession(agent, handle, session, { explicit: false })
    this.scheduleBroadcast(agent, { messages: true, immediate: true })
    return this.summary(agent)
  }

  async setFollow(agentID: string, follow: boolean): Promise<AgentSummary> {
    const agent = this.findAgent(agentID)
    agent.cfg.follow = follow
    agent.cfg.sessionId = follow ? undefined : agent.session?.id
    this.persist()
    this.broadcast({ type: 'config', data: publicConfig(this.config) })
    if (follow) void this.syncAgent(agent, { forceMessages: true })
    this.scheduleBroadcast(agent, { immediate: true })
    return this.summary(agent)
  }

  async seen(agentID: string): Promise<void> {
    const agent = this.findAgent(agentID)
    agent.unread = false
    agent.lastSeenAt = now()
    this.scheduleBroadcast(agent, { immediate: true })
  }

  async syncNow(agentID: string): Promise<AgentSummary> {
    const agent = this.findAgent(agentID)
    if (agent.connection.status !== 'online') {
      await this.connectAgent(agent)
    } else {
      await this.syncAgent(agent, { forceMessages: true })
    }
    return this.summary(agent)
  }

  async sendPrompt(agentID: string, text: string, delivery: Delivery = 'queue'): Promise<void> {
    const agent = this.findAgent(agentID)
    const trimmed = text.trim()
    if (!trimmed) throw new OpenCodeError('指令不能为空')
    if (trimmed.length > 30_000) throw new OpenCodeError('指令过长（最多 30000 字符）')
    if (!agent.cfg.directory) throw new OpenCodeError('请先配置项目目录')
    const handle = await this.resolveHandle(agent)
    agent.handleKey = handle.key

    let session = agent.session
    if (!session) {
      session = await handle.client.createSession({
        directory: agent.canonicalDirectory ?? agent.cfg.directory,
        title: trimmed.slice(0, 60),
      })
      agent.cfg.follow = false
      agent.cfg.sessionId = session.id
      this.persist()
      this.broadcast({ type: 'config', data: publicConfig(this.config) })
      await this.loadSession(agent, handle, session, { explicit: false })
    }

    try {
      await handle.client.prompt(session.id, trimmed, delivery)
    } catch (error) {
      const apiError = error as OpenCodeError
      if (delivery === 'steer' && (apiError.status === 409 || apiError.status === 400)) {
        await handle.client.prompt(session.id, trimmed, 'queue')
        this.notice('info', `${slotLabel(agent.cfg, agent.index)} 当前无法插话，已改为排队`)
      } else if (apiError.status === 404) {
        const fresh = await handle.client.createSession({
          directory: agent.canonicalDirectory ?? agent.cfg.directory,
          title: trimmed.slice(0, 60),
        })
        agent.cfg.follow = false
        agent.cfg.sessionId = fresh.id
        this.persist()
        await this.loadSession(agent, handle, fresh, { explicit: false })
        await handle.client.prompt(fresh.id, trimmed, delivery === 'steer' ? 'queue' : delivery)
        session = fresh
      } else {
        throw error
      }
    }

    agent.live = null
    agent.busy = true
    agent.unread = false
    agent.expectingResponse = true
    agent.lastError = undefined
    const optimistic: MessageView = {
      id: `local_${now()}`,
      role: 'user',
      created: now(),
      text: trimmed,
      optimistic: true,
    }
    agent.messages = [...agent.messages, optimistic].slice(-60)
    agent.messagesDirty = true
    this.scheduleBroadcast(agent, { messages: true, immediate: true })
    this.later(agent, 600, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
    this.later(agent, 2_000, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
    this.later(agent, 5_000, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
  }

  async interrupt(agentID: string): Promise<void> {
    const agent = this.findAgent(agentID)
    if (!agent.session) throw new OpenCodeError('当前没有可中断的会话')
    const handle = await this.resolveHandle(agent)
    await handle.client.interrupt(agent.session.id)
    agent.busy = false
    if (agent.live) agent.live.active = false
    this.scheduleBroadcast(agent, { immediate: true })
    this.later(agent, 300, () => { void this.syncAgent(agent).catch(() => { /* ignore */ }) })
  }

  async replyPermission(agentID: string, requestID: string, decision: PermissionDecision, message?: string): Promise<void> {
    const agent = this.findAgent(agentID)
    if (!agent.session) throw new OpenCodeError('当前没有可处理的会话')
    const handle = await this.resolveHandle(agent)
    await handle.client.replyPermission(agent.session.id, requestID, decision, message)
    agent.interactions.delete(requestID)
    this.scheduleBroadcast(agent, { immediate: true })
    this.notice('success', decision === 'reject' ? '已拒绝权限请求' : '已允许权限请求')
  }

  async replyForm(agentID: string, formID: string, answer: Record<string, unknown>): Promise<void> {
    const agent = this.findAgent(agentID)
    if (!agent.session) throw new OpenCodeError('当前没有可处理的会话')
    const handle = await this.resolveHandle(agent)
    await handle.client.replyForm(agent.session.id, formID, answer)
    agent.interactions.delete(formID)
    this.scheduleBroadcast(agent, { immediate: true })
    this.notice('success', '已提交回答')
  }

  async sendMany(targets: string[], text: string, delivery: Delivery): Promise<{ results: SendResult[] }> {
    const unique = [...new Set(targets)].filter(Boolean)
    if (unique.length === 0) throw new OpenCodeError('请至少选择一个目标')
    const results = await Promise.all(unique.map(async (agentID): Promise<SendResult> => {
      try {
        await this.sendPrompt(agentID, text, delivery)
        return { agentId: agentID, ok: true }
      } catch (error) {
        return { agentId: agentID, ok: false, error: errorText(error) }
      }
    }))
    return { results }
  }

  publicConfig(): PublicConfig {
    return publicConfig(this.config)
  }
}
