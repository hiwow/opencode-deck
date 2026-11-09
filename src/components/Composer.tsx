import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, CornerDownLeft, Loader2, MoreHorizontal, Send, Settings2, Users, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AgentView, Delivery, PublicAgentConfig } from '../../shared/types'
import { cn } from '@/lib/utils'
import { basename } from '../lib/format'
import { projectBorder, projectColor, projectTint } from '../lib/project-theme'

interface ComposerProps {
  configAgents: PublicAgentConfig[]
  agents: Record<string, AgentView>
  recipientId: string | null
  sending: boolean
  onSelectRecipient: (id: string) => void
  onSend: (text: string, delivery: Delivery, targetIds?: string[]) => Promise<boolean>
  onOpenSettings: () => void
}

export function Composer({
  configAgents,
  agents,
  recipientId,
  sending,
  onSelectRecipient,
  onSend,
  onOpenSettings,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [delivery, setDelivery] = useState<Delivery>('queue')
  const [batchDraft, setBatchDraft] = useState<{ text: string; delivery: Delivery } | null>(null)
  const [batchTargets, setBatchTargets] = useState<Set<string>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const configured = useMemo(() => configAgents.filter((agent) => agent.directory.trim()), [configAgents])
  const recipient = configured.find((agent) => agent.id === recipientId)
  const selectedBatch = configured.filter((agent) => batchTargets.has(agent.id))

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`
  }, [text])

  const send = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || !recipient || batchDraft) return
    const ok = await onSend(trimmed, delivery)
    if (ok) setText((current) => current.trim() === trimmed ? '' : current)
  }

  const sendBatch = async () => {
    if (!batchDraft || sending || selectedBatch.length < 2) return
    const ok = await onSend(batchDraft.text, batchDraft.delivery, selectedBatch.map((agent) => agent.id))
    if (ok) {
      setText((current) => current.trim() === batchDraft.text ? '' : current)
      setBatchDraft(null)
    }
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
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">发送到</span>
        <Select value={recipient?.id ?? ''} onValueChange={onSelectRecipient} disabled={sending}>
          <SelectTrigger size="sm" className="h-7 min-w-0 max-w-[240px] flex-1 text-[11px] sm:flex-none" aria-label="发送项目" data-composer-recipient>
            <SelectValue placeholder="选择发送项目" />
          </SelectTrigger>
          <SelectContent>
            {configAgents.map((agent, index) => agent.directory.trim() ? (
              <SelectItem key={agent.id} value={agent.id} className="text-xs">
                <span className={cn('size-1.5 rounded-full', agents[agent.id]?.connection.status !== 'online' && 'opacity-40')} style={{ backgroundColor: projectColor(index) }} />
                <span className="max-w-[220px] truncate">{agent.label || basename(agent.directory)}</span>
              </SelectItem>
            ) : null)}
          </SelectContent>
        </Select>
        <details className="relative ml-auto shrink-0">
          <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label="更多发送选项">
            <MoreHorizontal className="size-3.5" /> 更多
          </summary>
          <div className="absolute right-0 bottom-full z-20 mb-1 w-40 rounded-lg border bg-popover p-1 shadow-md">
            <button
              type="button"
              data-composer-batch
              disabled={sending || !text.trim() || configured.length < 2}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open')
                setBatchTargets(new Set(recipient ? [recipient.id] : []))
                setBatchDraft({ text: text.trim(), delivery })
              }}
            >
              <Users className="size-3.5" /> 多项目发送
            </button>
          </div>
        </details>
      </div>

      <div className="rounded-xl border border-input bg-background shadow-xs transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          data-composer-input
          placeholder={recipient ? `给 ${recipient.label || basename(recipient.directory)} 下达指令…` : '请先选择发送项目…'}
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
            disabled={sending || !text.trim() || !recipient || Boolean(batchDraft)}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            发送
          </Button>
        </div>
      </div>

      <Dialog open={Boolean(batchDraft)} onOpenChange={(open) => { if (!open && !sending) setBatchDraft(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>多项目发送</DialogTitle>
            <DialogDescription>选择接收同一条指令的项目，确认后发送。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {configAgents.map((agent, index) => {
              if (!agent.directory.trim()) return null
              const active = batchTargets.has(agent.id)
              return (
                <button
                  key={agent.id}
                  type="button"
                  data-composer-target={agent.id}
                  aria-pressed={active}
                  disabled={sending}
                  onClick={() => setBatchTargets((current) => {
                    const next = new Set(current)
                    if (next.has(agent.id)) next.delete(agent.id)
                    else next.add(agent.id)
                    return next
                  })}
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs disabled:opacity-50"
                  style={active ? { backgroundColor: projectTint(index, 12), borderColor: projectBorder(index, 35) } : undefined}
                >
                  <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: projectColor(index) }} />
                  <span className="truncate">{agent.label || basename(agent.directory)}</span>
                  {active ? <Check className="size-3 shrink-0" /> : null}
                </button>
              )
            })}
          </div>
          <div className="max-h-40 overflow-auto rounded-lg bg-muted/40 p-3 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{batchDraft?.text}</div>
          <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            接收项目：{selectedBatch.length ? selectedBatch.map((agent) => agent.label || basename(agent.directory)).join('、') : '尚未选择'}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={sending} onClick={() => setBatchDraft(null)}>取消</Button>
            <Button type="button" data-composer-batch-send disabled={sending || selectedBatch.length < 2} onClick={() => void sendBatch()}>
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              确认发送给 {selectedBatch.length} 个项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
