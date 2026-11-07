import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, CornerDownLeft, Loader2, Send, Settings2, Users, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgentView, Delivery, PublicAgentConfig } from '../../shared/types'
import { cn } from '@/lib/utils'
import { basename } from '../lib/format'
import { projectBorder, projectColor, projectTint } from '../lib/project-theme'

interface ComposerProps {
  configAgents: PublicAgentConfig[]
  agents: Record<string, AgentView>
  targets: Set<string>
  sending: boolean
  onToggleTarget: (id: string) => void
  onSelectAll: () => void
  onSend: (text: string, delivery: Delivery) => Promise<boolean>
  onOpenSettings: () => void
}

export function Composer({
  configAgents,
  agents,
  targets,
  sending,
  onToggleTarget,
  onSelectAll,
  onSend,
  onOpenSettings,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [delivery, setDelivery] = useState<Delivery>('queue')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const configured = useMemo(() => configAgents.filter((agent) => agent.directory.trim()), [configAgents])
  const selectedCount = useMemo(() => configured.filter((agent) => targets.has(agent.id)).length, [configured, targets])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`
  }, [text])

  const send = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || selectedCount === 0) return
    const ok = await onSend(trimmed, delivery)
    if (ok) setText('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  if (configured.length === 0) {
    return (
      <div className="border-t bg-background p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed bg-muted/20 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">还没有配置项目，先选一个 OpenCode 正在工作的目录。</span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenSettings}>
            <Settings2 className="size-3.5" /> 选择项目
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t bg-background/95 p-3 backdrop-blur">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          <Users className="size-3" /> 发送到
        </span>
        {configAgents.map((agent, index) => {
          if (!agent.directory.trim()) return null
          const active = targets.has(agent.id)
          const view = agents[agent.id]
          const online = view?.connection.status === 'online'
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onToggleTarget(agent.id)}
              title={agent.directory}
              data-composer-target={agent.id}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors',
                active ? 'font-medium text-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted/60',
              )}
              style={active ? { backgroundColor: projectTint(index, 12), borderColor: projectBorder(index, 35) } : undefined}
            >
              <span className={cn('size-1.5 rounded-full', !online && 'opacity-40')} style={{ backgroundColor: projectColor(index) }} />
              <span className="max-w-[110px] truncate">{agent.label || basename(agent.directory)}</span>
              {active ? <Check className="size-3" style={{ color: projectColor(index) }} /> : null}
            </button>
          )
        })}
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[10px] text-muted-foreground" onClick={onSelectAll}>
          {selectedCount === configured.length ? '全不选' : '全选'}
        </Button>
      </div>

      <div className="rounded-xl border border-input bg-background shadow-xs transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          data-composer-input
          placeholder="描述任务，发送给选中的项目…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          className="block max-h-[150px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2">
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <button
              type="button"
              className={cn('inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] transition-colors', delivery === 'queue' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setDelivery('queue')}
              title="等项目当前任务结束后处理"
            >
              <CornerDownLeft className="size-2.5" /> 排队
            </button>
            <button
              type="button"
              className={cn('inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] transition-colors', delivery === 'steer' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setDelivery('steer')}
              title="尝试插入当前运行中的任务"
            >
              <Zap className="size-2.5" /> 插话
            </button>
          </div>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">Ctrl / ⌘ + Enter 发送</span>
          <Button
            type="button"
            size="sm"
            data-composer-send
            className="ml-auto h-7 gap-1.5 px-3 text-[11px]"
            disabled={sending || !text.trim() || selectedCount === 0}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {selectedCount > 0 ? `发送给 ${selectedCount} 个` : '选择目标'}
          </Button>
        </div>
      </div>
    </div>
  )
}
