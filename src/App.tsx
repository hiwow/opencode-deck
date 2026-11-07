import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Power, RefreshCw, Settings2 } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import type { Delivery, PermissionDecision } from '../shared/types'
import { api } from './lib/api'
import { useLiveState } from './hooks/useLiveState'
import { useTheme } from './hooks/useTheme'
import { TooltipProvider } from './components/ui/tooltip'
import { TopBar } from './components/TopBar'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ProjectStrip } from './components/ProjectStrip'
import { UnifiedChat } from './components/UnifiedChat'
import { SettingsDialog } from './components/SettingsDialog'
import { Button } from './components/ui/button'

export default function App() {
  const { state, refresh } = useLiveState()
  const { theme, toggleTheme } = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [startingService, setStartingService] = useState(false)
  const [, setClockTick] = useState(0)
  const autoOpenedSettings = useRef(false)

  const config = state.config
  const configuredAgents = useMemo(
    () => (config ? config.agents.filter((agent) => agent.directory.trim()) : []),
    [config],
  )
  const targets = useMemo(
    () => new Set(configuredAgents.filter((agent) => !deselected.has(agent.id)).map((agent) => agent.id)),
    [configuredAgents, deselected],
  )
  const interactionCount = useMemo(
    () => configuredAgents.reduce((total, agent) => total + (state.agents[agent.id]?.interactions.length ?? 0), 0),
    [configuredAgents, state.agents],
  )
  const unreadCount = Object.values(state.agents).filter((agent) => agent.unread).length

  useEffect(() => {
    if (activeProject && !configuredAgents.some((agent) => agent.id === activeProject)) {
      setActiveProject(null)
    }
  }, [activeProject, configuredAgents])

  useEffect(() => {
    if (state.ready && !autoOpenedSettings.current && configuredAgents.length === 0) {
      autoOpenedSettings.current = true
      setSettingsOpen(true)
    }
  }, [state.ready, configuredAgents.length])

  useEffect(() => {
    document.title = interactionCount > 0
      ? `(${interactionCount}) 待处理 · OpenCode Deck`
      : unreadCount > 0
        ? `(${unreadCount}) OpenCode Deck`
        : 'OpenCode Deck'
  }, [interactionCount, unreadCount])

  useEffect(() => {
    const timer = setInterval(() => setClockTick((value) => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!config) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '0' || event.key === 'Escape') {
        setActiveProject(null)
        return
      }
      const index = Number.parseInt(event.key, 10) - 1
      if (index >= 0 && index < config.agents.length) {
        const agent = config.agents[index]
        if (agent?.directory) {
          setActiveProject((current) => (current === agent.id ? null : agent.id))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [config])

  const toggleTarget = (id: string) => {
    setDeselected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllTargets = () => {
    const allSelected = configuredAgents.every((agent) => targets.has(agent.id))
    setDeselected(allSelected ? new Set(configuredAgents.map((agent) => agent.id)) : new Set())
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      if (configuredAgents.length > 0) {
        const results = await Promise.allSettled(configuredAgents.map((agent) => api.sync(agent.id)))
        const failed = results.filter((result) => result.status === 'rejected').length
        if (failed > 0) toast.error(`${failed} 个项目同步失败，其余已刷新`)
      }
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRefreshing(false)
    }
  }

  const handleGlobalSend = async (text: string, delivery: Delivery): Promise<boolean> => {
    if (targets.size === 0) {
      toast.error('请至少选择一个目标项目')
      return false
    }
    setSending(true)
    try {
      const response = await api.send([...targets], text, delivery)
      const ok = response.results.filter((result) => result.ok).length
      const failed = response.results.filter((result) => !result.ok)
      if (ok > 0) toast.success(`指令已发送给 ${ok} 个项目`)
      if (failed.length > 0) toast.error(`${failed.length} 个项目发送失败：${failed[0]?.error ?? '未知错误'}`)
      return ok > 0
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSending(false)
    }
  }

  const handleInterrupt = async (agentId: string) => {
    try {
      await api.interrupt(agentId)
      toast.info('已请求中断当前运行')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const handleSeen = (agentId: string) => {
    void api.seen(agentId).catch(() => { /* ignore */ })
  }

  const handleSelectSession = async (agentId: string, sessionId: string) => {
    try {
      await api.selectSession(agentId, sessionId)
      toast.success('已切换会话')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const handleCreateSession = async (agentId: string) => {
    try {
      await api.createSession(agentId)
      toast.success('已新建会话')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const handleFollow = async (agentId: string, follow: boolean) => {
    try {
      await api.follow(agentId, follow)
      toast.info(follow ? '已开启跟随最新会话' : '已固定当前会话')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const handleReplyPermission = async (agentId: string, requestId: string, decision: PermissionDecision) => {
    try {
      await api.replyPermission(agentId, requestId, decision)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const handleReplyForm = async (agentId: string, formId: string, answer: Record<string, unknown>) => {
    try {
      await api.replyForm(agentId, formId, answer)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const handleSaveConfig = async (payload: { port: number; autoLoad: boolean; agents: unknown[] }) => {
    await api.saveConfig(payload)
    await refresh().catch(() => { /* SSE snapshot will reconcile */ })
    toast.success('配置已保存，正在连接项目…')
  }

  const handleStartService = async () => {
    setStartingService(true)
    try {
      await api.startService()
      await refresh().catch(() => { /* ignore */ })
      toast.success('共享服务已启动')
    } finally {
      setStartingService(false)
    }
  }

  const handleDiscover = async () => {
    await api.discover()
    await refresh().catch(() => { /* ignore */ })
  }

  const handleAutoLoad = async () => {
    try {
      const result = await api.autoLoad()
      if (result.applied.length > 0) {
        await refresh().catch(() => { /* ignore */ })
        setSettingsOpen(false)
        toast.success(result.message)
      } else {
        toast.info(result.message)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const startServiceFromBanner = async () => {
    setStartingService(true)
    try {
      await api.startService()
      await refresh().catch(() => { /* ignore */ })
      toast.success('共享服务已启动，正在接入项目')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setStartingService(false)
    }
  }

  const focusInteractions = () => {
    setActiveProject(null)
    requestAnimationFrame(() => {
      document.getElementById('interaction-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  if (!state.ready) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background">
        <div className="flex size-11 items-center justify-center rounded-xl border bg-card text-amber-600 shadow-sm dark:text-amber-400">
          <Loader2 className="size-5 animate-spin" />
        </div>
        <div className="font-mono text-[11px] tracking-[0.14em]">OPENCODE <span className="text-amber-600 dark:text-amber-400">DECK</span></div>
        <div className="text-xs text-muted-foreground">正在读取服务状态…</div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertTriangle className="size-5" />
        </div>
        <div className="font-mono text-[11px] tracking-[0.14em]">无法连接监控后端</div>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          确认后端已启动（默认 <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:5178</code>），然后重试。
        </p>
        <Button type="button" size="sm" className="h-8 text-xs" onClick={() => void handleRefresh()}>
          <RefreshCw className="size-3.5" /> 重试
        </Button>
        <Toaster theme={theme} richColors position="top-right" offset={{ top: 68, right: 16 }} />
      </div>
    )
  }

  const sharedAgents = configuredAgents.filter((agent) => agent.mode === 'shared')
  const sharedOffline = sharedAgents.length > 0 && sharedAgents.every((agent) => {
    const view = state.agents[agent.id]
    return !view || view.connection.status !== 'online'
  })
  const serviceStarting = state.service?.status === 'starting' || startingService

  return (
    <TooltipProvider>
      <div className="flex min-h-svh flex-col bg-background">
        <TopBar
          service={state.service}
          agents={state.agents}
          configuredCount={configuredAgents.length}
          connected={state.connected}
          interactions={interactionCount}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => setSettingsOpen(true)}
          onRefresh={() => void handleRefresh()}
          refreshing={refreshing}
          onFocusInteractions={focusInteractions}
        />

        <main className="mx-auto flex h-[calc(100svh-3.5rem)] w-full max-w-[1640px] flex-col gap-2 p-2.5 sm:p-4">
          {sharedOffline ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50/80 px-3 py-1.5 text-[11px] dark:bg-amber-950/20">
              <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-amber-900 dark:text-amber-100">
                  {serviceStarting ? '正在启动共享服务…' : '共享服务未连接'}
                </span>
                <span className="ml-2 text-amber-800/80 dark:text-amber-200/70">
                  {serviceStarting ? '启动后共享模式的项目会自动接入。' : state.service?.error || '启动 OpenCode 后台服务，或改用独立/手动服务。'}
                </span>
              </div>
              <Button type="button" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={() => void startServiceFromBanner()} disabled={serviceStarting}>
                {serviceStarting ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}
                {serviceStarting ? '启动中…' : '启动服务'}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-[10px]" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="size-3" /> 设置
              </Button>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 gap-3">
            <ProjectSidebar
              configAgents={config.agents}
              agents={state.agents}
              service={state.service}
              activeProject={activeProject}
              onActiveProject={setActiveProject}
              onOpenSettings={() => setSettingsOpen(true)}
              onSeen={handleSeen}
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <ProjectStrip
                configAgents={config.agents}
                agents={state.agents}
                activeProject={activeProject}
                onActiveProject={setActiveProject}
                onOpenSettings={() => setSettingsOpen(true)}
                onSeen={handleSeen}
              />
              <UnifiedChat
                configAgents={config.agents}
                agents={state.agents}
                connected={state.connected}
                activeProject={activeProject}
                onActiveProject={setActiveProject}
                targets={targets}
                sending={sending}
                onToggleTarget={toggleTarget}
                onSelectAllTargets={selectAllTargets}
                onSend={handleGlobalSend}
                onOpenSettings={() => setSettingsOpen(true)}
                onInterrupt={(id) => void handleInterrupt(id)}
                onReplyPermission={handleReplyPermission}
                onReplyForm={handleReplyForm}
                onSeen={handleSeen}
                onRefresh={() => void handleRefresh()}
                refreshing={refreshing}
                onSelectSession={handleSelectSession}
                onCreateSession={handleCreateSession}
                onFollow={handleFollow}
              />
            </div>
          </div>
        </main>

        <SettingsDialog
          open={settingsOpen}
          config={config}
          service={state.service}
          projects={state.projects}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveConfig}
          onStartService={handleStartService}
          onDiscover={handleDiscover}
          onAutoLoad={handleAutoLoad}
        />

        <Toaster theme={theme} richColors closeButton position="top-right" offset={{ top: 68, right: 16 }} mobileOffset={{ top: 62, right: 10 }} />
      </div>
    </TooltipProvider>
  )
}
