import {
  BellRing,
  Moon,
  RefreshCw,
  Server,
  Settings2,
  Sun,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentView, ServiceInfo } from '../../shared/types'
import { cn } from '@/lib/utils'
import type { Theme } from '../hooks/useTheme'

interface TopBarProps {
  service: ServiceInfo | null
  agents: Record<string, AgentView>
  configuredCount: number
  connected: boolean
  interactions: number
  theme: Theme
  onToggleTheme: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  refreshing: boolean
  onFocusInteractions: () => void
}

export function TopBar({
  service,
  agents,
  configuredCount,
  connected,
  interactions,
  theme,
  onToggleTheme,
  onOpenSettings,
  onRefresh,
  refreshing,
  onFocusInteractions,
}: TopBarProps) {
  const online = Object.values(agents).filter((agent) => agent.connection.status === 'online').length
  const serviceOnline = service?.status === 'online'

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1640px] items-center gap-2 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-xl bg-foreground font-mono text-sm font-bold text-background shadow-xs">
            <span className="-mr-0.5">›</span><span>_</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5 font-mono text-[11px] font-semibold tracking-[0.12em]">
              OPENCODE <span className="text-amber-600 dark:text-amber-400">DECK</span>
            </div>
            <div className="hidden text-[8px] tracking-[0.18em] text-muted-foreground sm:block">UNIFIED AGENT STREAM</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {interactions > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-amber-500/40 bg-amber-50 px-2 text-[10px] text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-200"
              onClick={onFocusInteractions}
            >
              <BellRing className="size-3 animate-deck-pulse" />
              <span className="hidden sm:inline">{interactions} 项待处理</span>
              <span className="sm:hidden">{interactions}</span>
            </Button>
          ) : null}

          <button
            type="button"
            onClick={onOpenSettings}
            className={cn(
              'hidden h-7 items-center gap-1.5 rounded-lg border px-2 text-[10px] transition-colors sm:inline-flex',
              serviceOnline
                ? 'border-emerald-500/25 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-300'
                : 'border-amber-500/25 bg-amber-50/60 text-amber-700 hover:bg-amber-50 dark:bg-amber-950/20 dark:text-amber-300',
            )}
            title={service?.error || service?.url || '共享服务'}
          >
            <span className={cn('size-1.5 rounded-full', serviceOnline ? 'bg-emerald-500' : 'bg-amber-500')} />
            <Server className="size-3" />
            <span>{serviceOnline ? '共享服务' : '服务离线'}</span>
            {service?.version ? <span className="font-mono text-[9px] opacity-70">v{service.version}</span> : null}
          </button>

          <Badge variant="outline" className="hidden h-7 gap-1 px-2 text-[10px] font-normal sm:inline-flex">
            <Users className="size-3" /> {online}/{configuredCount}
          </Badge>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn('mr-0.5 inline-flex items-center gap-1 text-[9px]', connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                <span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'animate-deck-pulse bg-amber-500')} />
                <span className="hidden md:inline">{connected ? '实时' : '重连中'}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{connected ? '浏览器 SSE 已连接' : '实时流断开，正在重连'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onToggleTheme} aria-label="切换明暗主题">
                {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{theme === 'dark' ? '切换到浅色' : '切换到深色'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onRefresh} disabled={refreshing} aria-label="刷新">
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新所有项目状态</TooltipContent>
          </Tooltip>

          <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-[10px]" onClick={onOpenSettings}>
            <Settings2 className="size-3.5" />
            <span className="hidden sm:inline">设置</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
