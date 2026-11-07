import {
  BellRing,
  ChevronRight,
  CircleDot,
  FolderPlus,
  Loader2,
  Radio,
  Settings2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AgentView, PublicAgentConfig, ServiceInfo } from '../../shared/types'
import { cn } from '@/lib/utils'
import { basename, relativeTime } from '../lib/format'
import { projectColor, projectTint, PROJECT_NUMBERS } from '../lib/project-theme'

interface ProjectSidebarProps {
  configAgents: PublicAgentConfig[]
  agents: Record<string, AgentView>
  service: ServiceInfo | null
  activeProject: string | null
  onActiveProject: (id: string | null) => void
  onOpenSettings: () => void
  onSeen: (id: string) => void
}

function statusOf(agent: AgentView | undefined): { label: string; className: string } {
  if (!agent?.configured) return { label: '未配置', className: 'text-muted-foreground' }
  if (agent.busy) return { label: '运行中', className: 'text-amber-600 dark:text-amber-400' }
  if (agent.connection.status === 'online') return { label: '在线', className: 'text-emerald-600 dark:text-emerald-400' }
  if (agent.connection.status === 'connecting') return { label: '连接中', className: 'text-sky-600 dark:text-sky-400' }
  return { label: '离线', className: 'text-muted-foreground' }
}

export function ProjectSidebar({
  configAgents,
  agents,
  service,
  activeProject,
  onActiveProject,
  onOpenSettings,
  onSeen,
}: ProjectSidebarProps) {
  const configured = configAgents.filter((agent) => agent.directory.trim())
  const online = configured.filter((config) => agents[config.id]?.connection.status === 'online').length
  const interactions = configured.reduce((total, config) => total + (agents[config.id]?.interactions.length ?? 0), 0)
  const serviceOnline = service?.status === 'online'

  return (
    <aside className="hidden h-full w-[292px] shrink-0 flex-col lg:flex">
      <div className="flex h-full min-h-0 flex-col rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b px-3.5 py-3">
          <div>
            <div className="text-sm font-semibold">项目</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {configured.length} 个槽位 · {online} 在线
            </div>
          </div>
          <Button type="button" size="icon" variant="ghost" className="size-8" onClick={onOpenSettings} title="项目与连接设置">
            <Settings2 className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => onActiveProject(null)}
            className={cn(
              'mb-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors',
              activeProject === null ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60',
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-lg border bg-background">
              <CircleDot className="size-3.5" />
            </span>
            <span>全部项目</span>
            <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[9px]">{configured.length}</Badge>
          </button>

          {configAgents.map((config, index) => {
            const agent = agents[config.id]
            const active = activeProject === config.id
            const status = statusOf(agent)
            const color = projectColor(index)
            const unread = agent?.unread
            const waiting = (agent?.interactions.length ?? 0) > 0
            const session = agent?.session
            const last = agent?.messages[agent.messages.length - 1]

            if (!config.directory.trim()) {
              return (
                <button
                  key={config.id}
                  type="button"
                  onClick={onOpenSettings}
                  className="mb-1 flex w-full items-center gap-2 rounded-xl border border-dashed px-2.5 py-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                >
                  <span className="flex size-6 items-center justify-center rounded-lg border border-dashed">
                    <FolderPlus className="size-3.5" />
                  </span>
                  <span className="flex-1">槽位 {PROJECT_NUMBERS[index]} · 添加项目</span>
                  <ChevronRight className="size-3.5 opacity-50" />
                </button>
              )
            }

            return (
              <button
                key={config.id}
                type="button"
                onClick={() => {
                  onActiveProject(active ? null : config.id)
                  onSeen(config.id)
                }}
                className={cn(
                  'group mb-1 w-full rounded-xl border px-2.5 py-2.5 text-left transition-colors',
                  active ? 'bg-muted/40' : 'border-transparent hover:bg-muted/45',
                )}
                data-project-row={config.id}
                title={config.directory}
                style={active ? { borderColor: projectTint(index, 40), backgroundColor: projectTint(index, 6) } : undefined}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold text-white shadow-xs dark:text-zinc-950"
                    style={{ backgroundColor: color }}
                  >
                    {PROJECT_NUMBERS[index]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold">{config.label || basename(config.directory)}</span>
                      {unread ? <span className="size-1.5 shrink-0 rounded-full bg-sky-500" /> : null}
                      {waiting ? (
                        <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                          <BellRing className="size-2.5 animate-deck-pulse" /> {agent?.interactions.length}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">{config.directory}</div>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                  <span className={cn('inline-flex items-center gap-1 font-medium', status.className)}>
                    {agent?.busy ? <Loader2 className="size-2.5 animate-spin" /> : <span className="size-1.5 rounded-full" style={{ backgroundColor: agent?.busy ? undefined : color }} />}
                    {status.label}
                  </span>
                  <span className="text-border">/</span>
                  <span className="min-w-0 truncate text-muted-foreground">{session?.title || '还没有会话'}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{last ? relativeTime(last.created) : '—'}</span>
                </div>

                {agent?.busy ? (
                  <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/2 animate-pulse rounded-full" style={{ backgroundColor: color }} />
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="border-t p-3">
          <div className="rounded-xl border bg-muted/25 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium">
              <Radio className="size-3" />
              共享后台服务
              <Badge variant="outline" className={cn('ml-auto h-4 px-1.5 text-[8px]', serviceOnline ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                {serviceOnline ? '在线' : '离线'}
              </Badge>
            </div>
            <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground">{service?.url || service?.error || '未连接'}</div>
            {interactions > 0 ? (
              <div className="mt-2 flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-1 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                <BellRing className="size-2.5 animate-deck-pulse" /> {interactions} 项等待你处理
              </div>
            ) : null}
          </div>
          <div className="mt-2 flex items-center justify-between px-0.5 text-[9px] text-muted-foreground">
            <span>按 1–4 快速筛选</span>
            <span>0 显示全部</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
