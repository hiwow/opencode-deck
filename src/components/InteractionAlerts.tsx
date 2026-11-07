import { useEffect, useMemo, useState } from 'react'
import {
  BellRing,
  ExternalLink,
  FileText,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AgentView, FormField, InteractionRequest, PermissionDecision, PublicAgentConfig } from '../../shared/types'
import { projectBorder, projectColor, PROJECT_NUMBERS } from '../lib/project-theme'
import { relativeTime } from '../lib/format'

interface InteractionAlertsProps {
  configAgents: PublicAgentConfig[]
  agents: Record<string, AgentView>
  onReplyPermission: (agentId: string, requestId: string, decision: PermissionDecision) => Promise<void>
  onReplyForm: (agentId: string, formId: string, answer: Record<string, unknown>) => Promise<void>
  onFocusProject: (agentId: string) => void
}

interface Item {
  agentId: string
  agentIndex: number
  agent: AgentView
  config: PublicAgentConfig
  interaction: InteractionRequest
}

function emptyValue(field: FormField): unknown {
  if (field.default !== undefined && field.default !== null) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'multiselect') return []
  return ''
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function FormFields({
  fields,
  onSubmit,
}: {
  fields: FormField[]
  onSubmit: (answer: Record<string, unknown>) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const field of fields) initial[field.key] = emptyValue(field)
    return initial
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (key: string, value: unknown) => setValues((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    for (const field of fields) {
      if (field.type === 'external') continue
      if (field.required && !hasValue(values[field.key])) {
        toast.error(`请填写「${field.title || field.key}」`)
        return
      }
    }
    setSubmitting(true)
    try {
      const answer: Record<string, unknown> = {}
      for (const field of fields) {
        if (field.type === 'external') continue
        const value = values[field.key]
        if (field.type === 'integer' && typeof value === 'string' && value !== '') answer[field.key] = Number.parseInt(value, 10)
        else if (field.type === 'number' && typeof value === 'string' && value !== '') answer[field.key] = Number(value)
        else answer[field.key] = value
      }
      await onSubmit(answer)
    } finally {
      setSubmitting(false)
    }
  }

  if (fields.length === 0) {
    return (
      <Button type="button" size="sm" className="h-8 text-xs" disabled={submitting} onClick={() => void submit()}>
        {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
        确认
      </Button>
    )
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const id = `field-${field.key}`
        const label = field.title || field.key
        if (field.type === 'external') {
          return (
            <a key={id} href={field.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-sky-600 underline underline-offset-4 dark:text-sky-400">
              <ExternalLink className="size-3.5" /> {label}
            </a>
          )
        }
        if (field.type === 'boolean') {
          return (
            <div key={id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
              <div>
                <Label htmlFor={id} className="text-xs">{label}</Label>
                {field.description ? <div className="mt-0.5 text-[10px] text-muted-foreground">{field.description}</div> : null}
              </div>
              <Switch id={id} checked={Boolean(values[field.key])} onCheckedChange={(checked) => update(field.key, checked)} />
            </div>
          )
        }
        if (field.type === 'multiselect') {
          const selected = Array.isArray(values[field.key]) ? values[field.key] as string[] : []
          return (
            <div key={id} className="space-y-1.5">
              <Label className="text-xs">{label}{field.required ? <span className="text-destructive">*</span> : null}</Label>
              {field.description ? <div className="text-[10px] text-muted-foreground">{field.description}</div> : null}
              <div className="flex flex-wrap gap-1.5">
                {(field.options ?? []).map((option) => {
                  const active = selected.includes(option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      title={option.description}
                      className={cn('rounded-md border px-2 py-1 text-[11px] transition-colors', active ? 'border-foreground bg-foreground text-background' : 'bg-background hover:bg-muted')}
                      onClick={() => update(field.key, active ? selected.filter((value) => value !== option.value) : [...selected, option.value])}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        }
        if (field.type === 'string' && field.options?.length) {
          return (
            <div key={id} className="space-y-1.5">
              <Label htmlFor={id} className="text-xs">{label}{field.required ? <span className="text-destructive">*</span> : null}</Label>
              <select
                id={id}
                value={String(values[field.key] ?? '')}
                onChange={(event) => update(field.key, event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">请选择…</option>
                {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          )
        }
        const isMultiline = field.type === 'string' && (field.maxLength ?? 200) > 120
        return (
          <div key={id} className="space-y-1.5">
            <Label htmlFor={id} className="text-xs">{label}{field.required ? <span className="text-destructive">*</span> : null}</Label>
            {isMultiline ? (
              <Textarea
                id={id}
                value={String(values[field.key] ?? '')}
                onChange={(event) => update(field.key, event.target.value)}
                placeholder={field.placeholder}
                minLength={field.minLength}
                maxLength={field.maxLength}
                className="min-h-20 text-sm"
              />
            ) : (
              <Input
                id={id}
                type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                value={String(values[field.key] ?? '')}
                onChange={(event) => update(field.key, event.target.value)}
                placeholder={field.placeholder}
                min={field.minimum}
                max={field.maximum}
                minLength={field.minLength}
                maxLength={field.maxLength}
                className="h-9 text-sm"
              />
            )}
            {field.description ? <div className="text-[10px] text-muted-foreground">{field.description}</div> : null}
          </div>
        )
      })}
      <Button type="button" size="sm" className="h-8 w-full text-xs" disabled={submitting} onClick={() => void submit()}>
        {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
        提交回答
      </Button>
    </div>
  )
}

function PermissionActions({
  item,
  busy,
  onReply,
}: {
  item: Item
  busy: boolean
  onReply: (decision: PermissionDecision) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button type="button" size="sm" className="h-7 gap-1 px-2.5 text-[10px]" disabled={busy} onClick={() => onReply('once')}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : <ShieldAlert className="size-3" />}
        允许一次
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-[10px]" disabled={busy} onClick={() => onReply('always')}>
        始终允许
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-[10px] text-destructive hover:text-destructive" disabled={busy} onClick={() => onReply('reject')}>
        <X className="size-3" /> 拒绝
      </Button>
      <span className="text-[9px] text-muted-foreground">结果会实时回到会话</span>
    </div>
  )
}

function InteractionRow({
  item,
  onReplyPermission,
  onOpenForm,
  onFocusProject,
}: {
  item: Item
  onReplyPermission: InteractionAlertsProps['onReplyPermission']
  onOpenForm: (item: Item) => void
  onFocusProject: (agentId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const color = projectColor(item.agentIndex)

  const reply = async (decision: PermissionDecision) => {
    setBusy(true)
    try {
      await onReplyPermission(item.agentId, item.interaction.id, decision)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-lg border bg-background px-2.5 py-2 shadow-xs"
      data-interaction-id={item.interaction.id}
      data-interaction-kind={item.interaction.kind}
      style={{ borderColor: projectBorder(item.agentIndex, 26), borderLeftWidth: 3, borderLeftColor: color }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded text-[8px] font-bold text-white dark:text-zinc-950"
          style={{ backgroundColor: color }}
        >
          {PROJECT_NUMBERS[item.agentIndex]}
        </span>
        <span className="text-[11px] font-semibold" style={{ color }}>{item.config.label || item.agent.label}</span>
        <Badge variant="outline" className="h-4 border-amber-500/30 bg-amber-50 px-1 text-[8px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          {item.interaction.kind === 'permission' ? '等待权限' : '等待填写'}
        </Badge>
        <span className="truncate text-[11px] font-medium">{item.interaction.title}</span>
        <span className="text-[9px] text-muted-foreground">{relativeTime(item.interaction.createdAt)}</span>
        <button type="button" className="ml-auto text-[9px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => onFocusProject(item.agentId)}>
          只看这个项目
        </button>
      </div>
      {item.interaction.description ? (
        <div className="mt-1 line-clamp-1 pl-7 text-[10px] text-muted-foreground">{item.interaction.description}</div>
      ) : null}
      {item.interaction.resources && item.interaction.resources.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1 pl-7">
          {item.interaction.resources.slice(0, 4).map((resource, index) => (
            <span key={`${resource}-${index}`} className="max-w-[260px] truncate rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">{resource}</span>
          ))}
          {item.interaction.resources.length > 4 ? <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">+{item.interaction.resources.length - 4}</span> : null}
        </div>
      ) : null}
      <div className="mt-1.5 pl-7">
        {item.interaction.kind === 'permission' ? (
          <PermissionActions item={item} busy={busy} onReply={(decision) => void reply(decision)} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="h-7 gap-1 px-2.5 text-[10px]" onClick={() => onOpenForm(item)}>
              <FileText className="size-3" /> 填写表单
            </Button>
            <span className="text-[9px] text-muted-foreground">{(item.interaction.fields ?? []).length} 个字段</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function InteractionAlerts({ configAgents, agents, onReplyPermission, onReplyForm, onFocusProject }: InteractionAlertsProps) {
  const [activeForm, setActiveForm] = useState<Item | null>(null)
  const items = useMemo<Item[]>(() => {
    return configAgents.flatMap((config, agentIndex) => {
      const agent = agents[config.id]
      if (!agent) return []
      return agent.interactions.map((interaction) => ({ agentId: config.id, agentIndex, agent, config, interaction }))
    })
  }, [agents, configAgents])

  useEffect(() => {
    if (!activeForm) return
    if (!items.some((item) => item.agentId === activeForm.agentId && item.interaction.id === activeForm.interaction.id)) {
      setActiveForm(null)
    }
  }, [activeForm, items])

  if (items.length === 0) return null

  const submitForm = async (answer: Record<string, unknown>) => {
    if (!activeForm) return
    await onReplyForm(activeForm.agentId, activeForm.interaction.id, answer)
    setActiveForm(null)
  }

  return (
    <section
      id="interaction-alerts"
      className="border-b border-amber-300/60 bg-amber-50/80 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/15"
      aria-live="polite"
    >
      <div className="mb-1.5 flex items-center gap-2 text-amber-800 dark:text-amber-200">
        <span className="relative flex size-5 items-center justify-center rounded-full bg-amber-500/15">
          <BellRing className="size-3 animate-deck-pulse" />
        </span>
        <span className="text-[11px] font-semibold">需要你处理 · {items.length}</span>
        <span className="text-[9px] text-amber-700/80 dark:text-amber-300/80">OpenCode 正在等待你的决定</span>
      </div>
      <div className="max-h-[42vh] space-y-1.5 overflow-y-auto pr-0.5 sm:max-h-60">
        {items.map((item) => (
          <InteractionRow
            key={`${item.agentId}:${item.interaction.id}`}
            item={item}
            onReplyPermission={onReplyPermission}
            onOpenForm={setActiveForm}
            onFocusProject={onFocusProject}
          />
        ))}
      </div>

      <Dialog open={Boolean(activeForm)} onOpenChange={(open) => { if (!open) setActiveForm(null) }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          {activeForm ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <span
                    className="flex size-6 items-center justify-center rounded-md text-[9px] font-bold text-white dark:text-zinc-950"
                    style={{ backgroundColor: projectColor(activeForm.agentIndex) }}
                  >
                    {PROJECT_NUMBERS[activeForm.agentIndex]}
                  </span>
                  <span className="text-xs font-medium" style={{ color: projectColor(activeForm.agentIndex) }}>
                    {activeForm.config.label || activeForm.agent.label}
                  </span>
                </div>
                <DialogTitle className="text-left text-base">{activeForm.interaction.title}</DialogTitle>
                <DialogDescription className="text-left text-xs">
                  OpenCode 需要这些信息才能继续当前任务。
                </DialogDescription>
              </DialogHeader>
              <FormFields key={activeForm.interaction.id} fields={(activeForm.interaction.fields ?? []).filter((field) => !field.hidden)} onSubmit={submitForm} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
