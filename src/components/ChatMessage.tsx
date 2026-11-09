import { useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Square,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { AgentView, PublicAgentConfig } from '../../shared/types'
import { cn } from '@/lib/utils'
import { projectColor, projectTint, PROJECT_NUMBERS } from '../lib/project-theme'
import { formatCost, modelLabel, relativeTime } from '../lib/format'
import type { FeedItem } from '../lib/feed'
import { Markdown } from './Markdown'
import { ToolList } from './ToolList'

interface ChatMessageProps {
  item: FeedItem
  agent: AgentView
  config: PublicAgentConfig
  onInterrupt: (agentId: string) => void
}

function AgentChip({ index, streaming = false }: { index: number; streaming?: boolean }) {
  const color = projectColor(index)
  return (
    <span
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold text-white shadow-xs dark:text-zinc-950',
        streaming && 'ring-2 ring-offset-2 ring-offset-background',
      )}
      style={{
        backgroundColor: color,
        ...(streaming ? { '--tw-ring-color': projectTint(index, 35) } as Record<string, string> : {}),
      }}
    >
      {PROJECT_NUMBERS[index]}
      {streaming ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-current" />
      ) : null}
    </span>
  )
}

function MessageMeta({
  item,
  agent,
  config,
  streaming,
  onInterrupt,
}: {
  item: FeedItem
  agent: AgentView
  config: PublicAgentConfig
  streaming: boolean
  onInterrupt: (agentId: string) => void
}) {
  const color = projectColor(item.agentIndex)
  return (
    <div className={cn('mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', item.role === 'user' && 'justify-end')}>
      <span className="font-semibold" style={{ color }}>{config.label || agent.label}</span>
      <span className="text-muted-foreground">{modelLabel(item.message?.model ?? agent.session?.model)}</span>
      <span className="text-muted-foreground/70">{relativeTime(item.created)}</span>
      {streaming ? (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: projectTint(item.agentIndex, 12), color }}>
          <span className="size-1.5 animate-deck-pulse rounded-full bg-current" />
          LIVE
        </span>
      ) : null}
      {streaming ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
          onClick={() => onInterrupt(item.agentId)}
        >
          <Square className="size-2.5" /> 停止
        </Button>
      ) : null}
    </div>
  )
}

export function ChatMessage({ item, agent, config, onInterrupt }: ChatMessageProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const color = projectColor(item.agentIndex)
  const tint = projectTint(item.agentIndex, 9)
  const borderTint = projectTint(item.agentIndex, 26)
  const streaming = Boolean(item.streaming)
  const message = item.message
  const live = item.live

  if (item.thinking) {
    return (
      <div className="flex gap-3">
        <AgentChip index={item.agentIndex} streaming />
        <div className="min-w-0 flex-1">
          <MessageMeta item={item} agent={agent} config={config} streaming={false} onInterrupt={onInterrupt} />
          <div
            className="inline-flex flex-wrap items-center gap-2.5 py-2 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" />
            <span>正在思考 / 调用工具…</span>
            <span className="flex gap-1">
              <i className="size-1 animate-deck-pulse rounded-full bg-current" />
              <i className="size-1 animate-deck-pulse rounded-full bg-current [animation-delay:150ms]" />
              <i className="size-1 animate-deck-pulse rounded-full bg-current [animation-delay:300ms]" />
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] sm:max-w-[78%]">
          <div className="mb-1.5 flex flex-wrap items-center justify-end gap-2 text-xs">
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: tint, color }}>指令</span>
            <span className="font-medium" style={{ color }}>{config.label || agent.label}</span>
            <span className="text-muted-foreground/70">{relativeTime(item.created)}</span>
          </div>
          <div
            className="rounded-2xl rounded-tr-md border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-xs"
            style={{ backgroundColor: tint, borderColor: borderTint }}
          >
            {message?.text || live?.text || ''}
          </div>
        </div>
      </div>
    )
  }

  const text = live?.text ?? message?.text ?? ''
  const reasoning = live?.reasoning ?? message?.reasoning
  const tools = live?.tools ?? message?.tools
  const error = message?.error

  return (
    <div className="flex gap-3">
      <AgentChip index={item.agentIndex} streaming={streaming} />
      <div className="min-w-0 flex-1">
        <MessageMeta item={item} agent={agent} config={config} streaming={streaming} onInterrupt={onInterrupt} />
        <div
          className="min-w-0 border-l px-3 py-1 sm:px-4"
          style={{ borderLeftColor: projectTint(item.agentIndex, 22) }}
        >
          {error ? (
            <Alert variant="destructive" className="mb-3 border-destructive/20 bg-destructive/5 py-2.5">
              <AlertTriangle />
              <AlertTitle className="text-xs">本轮执行失败</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}

          {text ? <Markdown text={text} streaming={streaming} /> : null}

          {!text && !error && streaming ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 正在生成回复…
            </div>
          ) : null}

          {!text && !error && !streaming ? (
            <div className="text-sm text-muted-foreground">本轮没有文本输出。</div>
          ) : null}

          {tools && tools.length > 0 ? <ToolList tools={tools} /> : null}

          {reasoning ? (
            <Collapsible open={reasoningOpen} onOpenChange={setReasoningOpen} className="mt-3 border-l-2 border-border/80 pl-3">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-0 text-[10px] text-muted-foreground hover:bg-transparent hover:text-foreground">
                  <ChevronDown className={cn('size-3 transition-transform', reasoningOpen && 'rotate-180')} />
                  思考过程
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 text-muted-foreground">
                  <Markdown text={reasoning} className="text-[12px]" />
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {message?.cost !== undefined || message?.tokens?.output ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
              {message?.cost !== undefined ? <span>{formatCost(message.cost)}</span> : null}
              {message?.tokens?.output ? <span>{message.tokens.output.toLocaleString()} tokens</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
