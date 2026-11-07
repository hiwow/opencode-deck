import { BellRing, Settings2 } from 'lucide-react'
import type { AgentView, PublicAgentConfig } from '../../shared/types'
import { cn } from '@/lib/utils'
import { basename } from '../lib/format'
import { projectBorder, projectColor, projectTint, PROJECT_NUMBERS } from '../lib/project-theme'

interface ProjectStripProps {
  configAgents: PublicAgentConfig[]
  agents: Record<string, AgentView>
  activeProject: string | null
  onActiveProject: (id: string | null) => void
  onOpenSettings: () => void
  onSeen: (id: string) => void
}

export function ProjectStrip({ configAgents, agents, activeProject, onActiveProject, onOpenSettings, onSeen }: ProjectStripProps) {
  const configured = configAgents.filter((agent) => agent.directory.trim())

  return (
    <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 lg:hidden">
      <button
        type="button"
        onClick={() => onActiveProject(null)}
        className={cn(
          'inline-flex h-8 shrink-0 items-center rounded-lg border px-2.5 text-[11px]',
          activeProject === null ? 'bg-foreground text-background' : 'bg-card text-muted-foreground',
        )}
      >
        全部
      </button>
      {configAgents.map((config, index) => {
        if (!config.directory.trim()) return null
        const agent = agents[config.id]
        const active = activeProject === config.id
        const waiting = (agent?.interactions.length ?? 0) > 0
        return (
          <button
            key={config.id}
            type="button"
            onClick={() => {
              onActiveProject(active ? null : config.id)
              onSeen(config.id)
            }}
            data-strip-project={config.id}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px]',
              active ? 'font-medium text-foreground' : 'border-border bg-card text-muted-foreground',
            )}
            style={active ? { backgroundColor: projectTint(index, 10), borderColor: projectBorder(index, 35) } : undefined}
          >
            <span className="flex size-4 items-center justify-center rounded text-[7px] font-bold text-white dark:text-zinc-950" style={{ backgroundColor: projectColor(index) }}>
              {PROJECT_NUMBERS[index]}
            </span>
            <span className="max-w-[86px] truncate">{config.label || basename(config.directory)}</span>
            {agent?.busy ? <span className="size-1.5 animate-deck-pulse rounded-full" style={{ backgroundColor: projectColor(index) }} /> : null}
            {agent?.unread ? <span className="size-1.5 rounded-full bg-sky-500" /> : null}
            {waiting ? <BellRing className="size-3 animate-deck-pulse text-amber-600 dark:text-amber-400" /> : null}
          </button>
        )
      })}
      {configured.length === 0 ? (
        <button type="button" onClick={onOpenSettings} className="inline-flex h-8 shrink-0 items-center rounded-lg border border-dashed px-2.5 text-[11px] text-muted-foreground">
          添加项目
        </button>
      ) : null}
      <button type="button" onClick={onOpenSettings} className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground" aria-label="设置">
        <Settings2 className="size-3.5" />
      </button>
    </div>
  )
}
