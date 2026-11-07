import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  Wrench,
  XCircle,
} from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ToolCallView } from '../../shared/types'
import { prettyUnknown, stripAnsi, truncate } from '../lib/format'

function ToolStatusIcon({ status }: { status: ToolCallView['status'] }) {
  if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-amber-600 dark:text-amber-400" />
  if (status === 'completed') return <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
  if (status === 'error') return <XCircle className="size-3.5 text-destructive" />
  return <Circle className="size-3.5 text-muted-foreground" />
}

function ToolRow({ tool }: { tool: ToolCallView }) {
  const [open, setOpen] = useState(false)
  const hasDetails = tool.input !== undefined || Boolean(tool.output)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border/70 bg-background/40">
      <CollapsibleTrigger asChild disabled={!hasDetails}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-default"
        >
          <ToolStatusIcon status={tool.status} />
          <span className="font-mono text-[11px] font-medium">{tool.name}</span>
          {tool.title ? <span className="min-w-0 truncate text-muted-foreground">{truncate(tool.title, 56)}</span> : null}
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {tool.status === 'completed' ? '完成' : tool.status === 'error' ? '失败' : '运行中'}
          </span>
          {hasDetails ? <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} /> : null}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-border/60 px-2.5 py-2">
          {tool.input !== undefined && tool.input !== null ? (
            <div>
              <div className="mb-1 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">输入</div>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                {prettyUnknown(tool.input, 1_800)}
              </pre>
            </div>
          ) : null}
          {tool.output ? (
            <div>
              <div className="mb-1 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">输出</div>
              <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                {stripAnsi(tool.output)}
              </pre>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ToolList({ tools }: { tools: ToolCallView[] }) {
  const running = tools.some((tool) => tool.status === 'running' || tool.status === 'pending')
  const [open, setOpen] = useState(running)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3 rounded-xl border border-border/70 bg-muted/20">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-full justify-start gap-2 rounded-xl px-2.5 text-xs text-muted-foreground hover:text-foreground">
          <Wrench className="size-3.5" />
          <span>工具调用</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px]">{tools.length}</span>
          {running ? <span className="text-[10px] text-amber-600 dark:text-amber-400">进行中</span> : null}
          <ChevronDown className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1.5 border-t border-border/60 p-2">
          {tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
