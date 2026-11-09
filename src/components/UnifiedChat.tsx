import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDown,
  BellRing,
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import type {
  AgentView,
  Delivery,
  PermissionDecision,
  PublicAgentConfig,
  SessionInfo,
} from '../../shared/types'
import { api } from '../lib/api'
import { cn } from '@/lib/utils'
import { basename, modelLabel, relativeTime } from '../lib/format'
import { agentMessageCount, buildFeed } from '../lib/feed'
import { projectColor, projectTint, PROJECT_NUMBERS } from '../lib/project-theme'
import { ChatMessage } from './ChatMessage'
import { Composer } from './Composer'
import { InteractionAlerts } from './InteractionAlerts'

interface UnifiedChatProps {
  configAgents: PublicAgentConfig[]
  agents: Record<string, AgentView>
  connected: boolean
  activeProject: string | null
  onActiveProject: (id: string | null) => void
  recipientId: string | null
  sending: boolean
  onSelectRecipient: (id: string) => void
  onSend: (text: string, delivery: Delivery, targetIds?: string[]) => Promise<boolean>
  onOpenSettings: () => void
  onInterrupt: (agentId: string) => void
  onReplyPermission: (agentId: string, requestId: string, decision: PermissionDecision) => Promise<void>
  onReplyForm: (agentId: string, formId: string, answer: Record<string, unknown>) => Promise<void>
  onSeen: (agentId: string) => void
  onRefresh: () => void
  refreshing: boolean
  onSelectSession: (agentId: string, sessionId: string) => Promise<void>
  onCreateSession: (agentId: string) => Promise<void>
  onFollow: (agentId: string, follow: boolean) => Promise<void>
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diff = Math.round((startOfToday - startOfDate) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function UnifiedChat({
  configAgents,
  agents,
  connected,
  activeProject,
  onActiveProject,
  recipientId,
  sending,
  onSelectRecipient,
  onSend,
  onOpenSettings,
  onInterrupt,
  onReplyPermission,
  onReplyForm,
  onSeen,
  onRefresh,
  refreshing,
  onSelectSession,
  onCreateSession,
  onFollow,
}: UnifiedChatProps) {
  const configured = useMemo(() => configAgents.filter((agent) => agent.directory.trim()), [configAgents])
  const visible = useMemo(
    () => new Set(activeProject ? [activeProject] : configured.map((agent) => agent.id)),
    [activeProject, configured],
  )
  const feed = useMemo(
    () => buildFeed({ agents, configAgents, visible }),
    [agents, configAgents, visible],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionBusy, setSessionBusy] = useState(false)
  const lastItem = feed[feed.length - 1]
  const interactions = configured.reduce((total, config) => total + (agents[config.id]?.interactions.length ?? 0), 0)
  const online = configured.filter((config) => agents[config.id]?.connection.status === 'online').length
  const busy = configured.filter((config) => agents[config.id]?.busy).length
  const activeConfig = activeProject ? configAgents.find((config) => config.id === activeProject) : undefined
  const activeAgent = activeProject ? agents[activeProject] : undefined
  const activeIndex = activeProject ? configAgents.findIndex((config) => config.id === activeProject) : -1
  const activeLabel = activeProject
    ? activeConfig?.label || (activeConfig?.directory ? basename(activeConfig.directory) : '所选项目')
    : '全部项目'

  const openSessions = async () => {
    if (!activeProject) return
    setSessionOpen(true)
    setSessionsLoading(true)
    setSessionError(null)
    try {
      setSessions(await api.sessions(activeProject))
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionsLoading(false)
    }
  }

  const chooseSession = async (sessionId: string) => {
    if (!activeProject) return
    setSessionBusy(true)
    try {
      await onSelectSession(activeProject, sessionId)
      setSessionOpen(false)
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionBusy(false)
    }
  }

  const createSession = async () => {
    if (!activeProject) return
    setSessionBusy(true)
    try {
      await onCreateSession(activeProject)
      setSessionOpen(false)
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionBusy(false)
    }
  }

  const scrollToBottom = (smooth = false) => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stickRef.current = true
    setAtBottom(true)
  }

  useEffect(() => {
    stickRef.current = true
    setAtBottom(true)
    requestAnimationFrame(() => {
      scrollToBottom(false)
    })
  }, [activeProject])

  useEffect(() => {
    if (!stickRef.current) return
    requestAnimationFrame(() => scrollToBottom(false))
  }, [feed.length, lastItem?.key, lastItem?.live?.text, lastItem?.message?.text, lastItem?.live?.tools?.length, lastItem?.message?.tools?.length])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    stickRef.current = nearBottom
    setAtBottom(nearBottom)
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">统一进度流</h1>
            <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[9px]">{feed.length}</Badge>
            {interactions > 0 ? (
              <Badge variant="outline" className="h-5 gap-1 border-amber-500/30 bg-amber-50 px-1.5 text-[9px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <BellRing className="size-2.5 animate-deck-pulse" /> {interactions} 待处理
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span>{activeLabel}</span>
            {activeConfig ? (
              <button
                type="button"
                onClick={() => void openSessions()}
                className="inline-flex h-5 max-w-[280px] items-center gap-1 rounded border bg-background px-1.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                title="切换这个项目的会话"
              >
                <MessageSquare className="size-2.5 shrink-0" />
                <span className="truncate">{activeAgent?.session?.title || '选择会话'}</span>
                <ChevronDown className="size-2.5 shrink-0" />
              </button>
            ) : null}
            <span>·</span>
            <span>{online} / {configured.length} 在线</span>
            {busy > 0 ? <span className="text-amber-600 dark:text-amber-400">· {busy} 运行中</span> : null}
            <span>·</span>
            <span>消息按时间交织</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:inline-flex">
            <span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500 animate-deck-pulse')} />
            {connected ? '实时' : '重连中'}
          </span>
          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onRefresh} disabled={refreshing} title="立即同步">
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-7 lg:hidden" onClick={onOpenSettings} title="设置">
            <Settings2 className="size-4" />
          </Button>
        </div>
      </header>

      <div className="hidden items-center gap-1.5 border-b bg-muted/20 px-3 py-1.5 sm:flex">
        <button
          type="button"
          onClick={() => onActiveProject(null)}
          data-project-filter="all"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors',
            activeProject === null ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
          )}
        >
          <MessageSquare className="size-3" /> 全部
        </button>
        {configAgents.map((config, index) => {
          if (!config.directory.trim()) return null
          const agent = agents[config.id]
          const active = activeProject === config.id
          const unread = agent?.unread
          const waiting = (agent?.interactions.length ?? 0) > 0
          return (
            <button
              key={config.id}
              type="button"
              onClick={() => {
                onActiveProject(active ? null : config.id)
                onSeen(config.id)
              }}
              title={config.directory}
              data-project-filter={config.id}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors',
                active ? 'bg-background font-medium text-foreground shadow-xs' : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground',
              )}
              style={active ? { backgroundColor: projectTint(index, 10), borderColor: projectTint(index, 35) } : undefined}
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: projectColor(index) }} />
              <span className="max-w-[100px] truncate">{config.label || basename(config.directory)}</span>
              {agent?.busy ? <span className="size-1.5 animate-deck-pulse rounded-full" style={{ backgroundColor: projectColor(index) }} /> : null}
              {unread ? <span className="size-1.5 rounded-full bg-sky-500" /> : null}
              {waiting ? <BellRing className="size-3 animate-deck-pulse text-amber-600 dark:text-amber-400" /> : null}
              <span className="hidden text-[9px] text-muted-foreground md:inline">{agentMessageCount(agent)}</span>
            </button>
          )
        })}
        <button type="button" onClick={() => onActiveProject(null)} className="ml-auto text-[9px] text-muted-foreground hover:text-foreground">
          按 1–4 切换
        </button>
      </div>

      <InteractionAlerts
        configAgents={configAgents}
        agents={agents}
        onReplyPermission={onReplyPermission}
        onReplyForm={onReplyForm}
        onFocusProject={(id) => onActiveProject(id)}
      />

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto px-3 py-4 sm:px-5">
          <div className={cn('flex w-full min-w-0 flex-col gap-5', feed.length === 0 && 'min-h-full justify-center')}>
            {feed.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-muted/15 px-6 py-12 text-center">
                <span className="flex size-11 items-center justify-center rounded-2xl border bg-background shadow-xs">
                  <Sparkles className="size-5" style={{ color: activeProject ? projectColor(configAgents.findIndex((config) => config.id === activeProject)) : 'var(--muted-foreground)' }} />
                </span>
                <div>
                  <div className="text-sm font-medium">
                    {configured.length === 0 ? '还没有配置项目' : activeProject ? '这个项目还没有消息' : '等待第一条指令'}
                  </div>
                  <div className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    {configured.length === 0
                      ? '在设置里选择最多四个 OpenCode 项目，所有进度会汇入这一个窗口。'
                      : activeProject
                        ? '切回“全部”可以看其他项目的进度，或在下方直接给这个项目发指令。'
                        : '先选择一个项目，再下达指令。各项目的回复会按时间交织显示。'}
                  </div>
                </div>
                {configured.length === 0 ? (
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onOpenSettings}>
                    <Settings2 className="size-3.5" /> 选择项目
                  </Button>
                ) : null}
              </div>
            ) : (
              (() => {
                const nodes: ReactNode[] = []
                let previousDay = ''
                feed.forEach((item) => {
                  const agent = agents[item.agentId]
                  const config = configAgents[item.agentIndex]
                  if (!agent || !config) return
                  const day = dayLabel(item.created)
                  if (day !== previousDay) {
                    previousDay = day
                    nodes.push(
                      <div key={`day-${day}`} className="flex items-center gap-3 py-1 text-[10px] text-muted-foreground">
                        <Separator className="flex-1" />
                        <span>{day}</span>
                        <Separator className="flex-1" />
                      </div>,
                    )
                  }
                  nodes.push(
                    <ChatMessage
                      key={item.key}
                      item={item}
                      agent={agent}
                      config={config}
                      onInterrupt={onInterrupt}
                    />,
                  )
                })
                return nodes
              })()
            )}
          </div>
        </div>

        {!atBottom && feed.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute right-4 bottom-3 h-7 gap-1 rounded-full px-2.5 text-[10px] shadow-md"
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDown className="size-3" /> 回到底部
          </Button>
        ) : null}
      </div>

      <Composer
        configAgents={configAgents}
        agents={agents}
        recipientId={recipientId}
        sending={sending}
        onSelectRecipient={onSelectRecipient}
        onSend={onSend}
        onOpenSettings={onOpenSettings}
      />

      <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span
                className="flex size-5 items-center justify-center rounded text-[8px] font-bold text-white dark:text-zinc-950"
                style={{ backgroundColor: projectColor(Math.max(0, activeIndex)) }}
              >
                {PROJECT_NUMBERS[Math.max(0, activeIndex)]}
              </span>
              <span className="text-xs font-medium" style={{ color: projectColor(Math.max(0, activeIndex)) }}>
                {activeLabel}
              </span>
            </div>
            <DialogTitle className="text-left text-base">切换会话</DialogTitle>
            <DialogDescription className="text-left text-xs">
              选择该项目要监控的会话。发送指令不会自动切换会话。
            </DialogDescription>
          </DialogHeader>

          <Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={() => void createSession()} disabled={sessionBusy}>
            {sessionBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            新建会话
          </Button>

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {sessionsLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> 正在读取会话…</div>
            ) : sessionError ? (
              <div className="py-6 text-center text-xs text-destructive">{sessionError}</div>
            ) : sessions.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">这个项目还没有会话</div>
            ) : (
              sessions.map((session) => {
                const current = session.id === activeAgent?.session?.id
                return (
                  <button
                    key={session.id}
                    type="button"
                    data-session-option={session.id}
                    onClick={() => void chooseSession(session.id)}
                    disabled={sessionBusy}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      current ? 'border-foreground/25 bg-muted/50' : 'border-transparent hover:bg-muted/50',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{session.title || '未命名会话'}</div>
                      <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
                        {modelLabel(session.model)} · {relativeTime(session.time.updated ?? session.time.created)}
                      </div>
                    </div>
                    {current ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
            <div>
              <div className="text-xs font-medium">跟随最新会话</div>
              <div className="text-[10px] text-muted-foreground">关闭后固定当前会话，不随 TUI 切换</div>
            </div>
            <Switch
              checked={activeAgent?.follow ?? true}
              onCheckedChange={(checked) => { if (activeProject) void onFollow(activeProject, checked) }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
