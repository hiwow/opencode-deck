import fs from 'node:fs'
import path from 'node:path'
import type { AgentConfig, AgentMode, AppConfig, PublicAgentConfig, PublicConfig } from '../shared/types'

const SLOT_COUNT = 4

export function defaultConfig(): AppConfig {
  return {
    port: 5178,
    autoLoad: true,
    agents: Array.from({ length: SLOT_COUNT }, (_, index) => ({
      id: `slot-${index + 1}`,
      label: '',
      directory: '',
      mode: 'shared' as AgentMode,
      follow: true,
    })),
  }
}

export function resolveConfigPath(root: string): string {
  return process.env.OPENCODE_DECK_CONFIG?.trim() || path.join(root, 'config.json')
}

function normalizeAgent(raw: Partial<AgentConfig>, fallback: AgentConfig, index: number): AgentConfig {
  const mode: AgentMode = raw.mode === 'manual' || raw.mode === 'dedicated' || raw.mode === 'shared' ? raw.mode : fallback.mode
  const directory = String(raw.directory ?? fallback.directory ?? '').trim()
  const directoryChanged = directory !== (fallback.directory ?? '')
  const modeChanged = mode !== fallback.mode
  return {
    id: `slot-${index + 1}`,
    label: String(raw.label ?? fallback.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    directory,
    mode,
    follow: raw.follow === undefined ? fallback.follow : Boolean(raw.follow),
    serverUrl: String(raw.serverUrl ?? fallback.serverUrl ?? '').trim().replace(/\/+$/, ''),
    password: mode === 'manual' ? (typeof raw.password === 'string' && raw.password.length > 0 ? raw.password : fallback.password) : undefined,
    sessionId: directoryChanged || modeChanged ? undefined : (typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : fallback.sessionId),
    dedicatedPort: directoryChanged || modeChanged ? undefined : (typeof fallback.dedicatedPort === 'number' ? fallback.dedicatedPort : undefined),
    dedicatedPassword: directoryChanged || modeChanged ? undefined : (typeof fallback.dedicatedPassword === 'string' ? fallback.dedicatedPassword : undefined),
  }
}

export function loadConfig(root: string): AppConfig {
  const configPath = resolveConfigPath(root)
  const base = defaultConfig()
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AppConfig>
    const rawAgents = Array.isArray(raw.agents) ? raw.agents : []
    base.agents = base.agents.map((slot, index) => normalizeAgent(rawAgents[index] ?? {}, slot, index))
    if (typeof raw.port === 'number' && raw.port >= 1024 && raw.port <= 65535) base.port = Math.floor(raw.port)
    if (typeof raw.autoLoad === 'boolean') base.autoLoad = raw.autoLoad
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[config] 读取 ${configPath} 失败，使用默认配置：`, (error as Error).message)
    }
  }
  return base
}

export function saveConfig(root: string, config: AppConfig): void {
  const configPath = resolveConfigPath(root)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const body = JSON.stringify(config, null, 2) + '\n'
  const tempPath = `${configPath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, body, 'utf8')
  try {
    fs.renameSync(tempPath, configPath)
  } catch {
    fs.writeFileSync(configPath, body, 'utf8')
    try { fs.unlinkSync(tempPath) } catch { /* ignore */ }
  }
}

export function sanitizeConfig(input: unknown, existing: AppConfig): AppConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<AppConfig>
  const rawAgents = Array.isArray(raw.agents) ? raw.agents : []
  const next: AppConfig = {
    port: typeof raw.port === 'number' && raw.port >= 1024 && raw.port <= 65535 ? Math.floor(raw.port) : existing.port,
    autoLoad: typeof raw.autoLoad === 'boolean' ? raw.autoLoad : existing.autoLoad,
    agents: existing.agents.map((fallback, index) => normalizeAgent(rawAgents[index] ?? {}, fallback, index)),
  }
  // Four fixed slots keep the UI and routing predictable.
  while (next.agents.length < SLOT_COUNT) {
    next.agents.push({ ...defaultConfig().agents[next.agents.length]! })
  }
  return next
}

export function publicConfig(config: AppConfig): PublicConfig {
  return {
    port: config.port,
    autoLoad: config.autoLoad,
    agents: config.agents.slice(0, SLOT_COUNT).map((agent): PublicAgentConfig => ({
      id: agent.id,
      label: agent.label,
      directory: agent.directory,
      mode: agent.mode,
      follow: agent.follow,
      serverUrl: agent.serverUrl,
      hasPassword: Boolean(agent.password),
      sessionId: agent.sessionId,
      dedicatedPort: agent.dedicatedPort,
    })),
  }
}

export function slotLabel(agent: Pick<AgentConfig, 'label' | 'directory'>, index: number): string {
  if (agent.label.trim()) return agent.label.trim()
  if (agent.directory.trim()) {
    const normalized = agent.directory.replace(/[\\/]+$/, '')
    const base = normalized.split(/[\\/]/).filter(Boolean).pop()
    if (base) return base
  }
  return `项目 ${index + 1}`
}
