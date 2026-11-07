export type AgentMode = 'shared' | 'dedicated' | 'manual'
export type ConnectionStatus = 'online' | 'offline' | 'connecting' | 'starting' | 'error'
export type Delivery = 'queue' | 'steer'

export interface AgentConfig {
  id: string
  label: string
  directory: string
  mode: AgentMode
  follow: boolean
  serverUrl?: string
  password?: string
  hasPassword?: boolean
  sessionId?: string
  dedicatedPort?: number
  dedicatedPassword?: string
}

export interface PublicAgentConfig {
  id: string
  label: string
  directory: string
  mode: AgentMode
  follow: boolean
  serverUrl?: string
  hasPassword: boolean
  sessionId?: string
  dedicatedPort?: number
}

export interface AppConfig {
  port: number
  autoLoad: boolean
  agents: AgentConfig[]
}

export interface PublicConfig {
  port: number
  autoLoad: boolean
  agents: PublicAgentConfig[]
}

export interface ModelRef {
  id: string
  providerID: string
  variant?: string
}

export interface TokenInfo {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

export interface SessionTimes {
  created: number
  updated?: number
  busy?: number
  idle?: number
  viewed?: number
  archived?: number
}

export interface SessionInfo {
  id: string
  parentID?: string
  projectID?: string
  title?: string
  agent?: string
  model?: ModelRef
  cost?: number
  tokens?: TokenInfo
  outcome?: 'succeeded' | 'failed' | 'interrupted'
  time: SessionTimes
  location?: { directory: string }
  subpath?: string
}

export interface ToolCallView {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  input?: unknown
  output?: string
  title?: string
}

export interface MessageView {
  id: string
  role: 'user' | 'assistant'
  created: number
  text: string
  reasoning?: string
  tools?: ToolCallView[]
  agent?: string
  model?: ModelRef
  cost?: number
  tokens?: TokenInfo
  error?: string
  finish?: string
  optimistic?: boolean
}

export interface LiveView {
  id: string
  text: string
  reasoning?: string
  tools?: ToolCallView[]
  startedAt: number
  active: boolean
}

export interface ConnectionInfo {
  status: ConnectionStatus
  url?: string
  version?: string
  error?: string
  sse?: 'live' | 'connecting' | 'offline'
  managed?: boolean
  mode?: AgentMode
}

export type InteractionKind = 'permission' | 'form'
export type PermissionDecision = 'once' | 'always' | 'reject'

export interface FormFieldOption {
  value: string
  label: string
  description?: string
}

export interface FormField {
  key: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external'
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  options?: FormFieldOption[]
  placeholder?: string
  default?: unknown
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  url?: string
}

export interface InteractionRequest {
  id: string
  kind: InteractionKind
  sessionID: string
  createdAt: number
  title: string
  description?: string
  action?: string
  resources?: string[]
  message?: string
  fields?: FormField[]
  metadata?: Record<string, unknown>
}

export interface AgentView {
  id: string
  label: string
  directory: string
  mode: AgentMode
  follow: boolean
  configured: boolean
  connection: ConnectionInfo
  session: SessionInfo | null
  busy: boolean
  unread: boolean
  live: LiveView | null
  messages: MessageView[]
  interactions: InteractionRequest[]
  lastSynced?: number
  lastError?: string
}

export type AgentSummary = Omit<AgentView, 'messages'>

export interface ServiceInfo {
  status: 'online' | 'offline' | 'starting' | 'error'
  url?: string
  version?: string
  error?: string
  file?: string
  managed?: boolean
  pid?: number
}

export interface ProjectInfo {
  id: string
  canonical: string
  name?: string
  vcs?: string
  time?: { created: number; updated: number; active?: number }
  sessions?: number
  lastActive?: number
}

export type OpenCodeProcessKind = 'tui' | 'serve' | 'other'

export interface DetectedOpenCodeProcess {
  pid: number
  name: string
  commandLine: string
  kind: OpenCodeProcessKind
  transport?: 'shared' | 'standalone' | 'remote'
  directory?: string
}

export interface AutoLoadCandidate {
  directory: string
  label: string
  source: 'process' | 'recent'
}

export interface AutoLoadApplied {
  slotId: string
  directory: string
  label: string
}

export interface AutoLoadResult {
  detected: DetectedOpenCodeProcess[]
  candidates: AutoLoadCandidate[]
  applied: AutoLoadApplied[]
  message: string
}

export interface Bootstrap {
  config: PublicConfig
  service: ServiceInfo
  agents: AgentView[]
  projects: ProjectInfo[]
  now: number
}

export interface SendResult {
  agentId: string
  ok: boolean
  error?: string
}

export interface SendResponse {
  results: SendResult[]
}

export interface ActionResponse {
  ok: boolean
  message?: string
}

export type ServerEvent =
  | { type: 'snapshot'; data: Bootstrap }
  | { type: 'agent'; data: AgentSummary }
  | { type: 'messages'; data: { agentId: string; messages: MessageView[] } }
  | { type: 'config'; data: PublicConfig }
  | { type: 'service'; data: ServiceInfo }
  | { type: 'projects'; data: ProjectInfo[] }
  | { type: 'notice'; data: { level: 'info' | 'success' | 'error'; message: string } }

export interface NormalizedSession {
  id: string
  title: string
  agent?: string
  model?: ModelRef
  cost?: number
  tokens?: TokenInfo
  created: number
  updated: number
  busy: boolean
  raw: SessionInfo
}

export interface AgentRuntimeView extends AgentSummary {
  messages: MessageView[]
}
