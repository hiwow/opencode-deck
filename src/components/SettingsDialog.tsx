import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  PlugZap,
  Power,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import type { PublicAgentConfig, PublicConfig, ProjectInfo, ServiceInfo } from '../../shared/types'
import { cn } from '@/lib/utils'
import { basename } from '../lib/format'

interface AgentDraft extends PublicAgentConfig {
  password?: string
}

interface ConfigDraft {
  port: number
  autoLoad: boolean
  agents: AgentDraft[]
}

interface SettingsDialogProps {
  open: boolean
  config: PublicConfig | null
  service: ServiceInfo | null
  projects: ProjectInfo[]
  onClose: () => void
  onSave: (config: { port: number; autoLoad: boolean; agents: unknown[] }) => Promise<void>
  onStartService: () => Promise<void>
  onDiscover: () => Promise<void>
  onAutoLoad: () => Promise<void>
}

const MODES: Array<{ value: PublicAgentConfig['mode']; label: string; hint: string }> = [
  { value: 'shared', label: '共享服务', hint: '复用 TUI 的后台服务，自动发现' },
  { value: 'dedicated', label: '独立服务', hint: '为这个项目单独启动 opencode serve' },
  { value: 'manual', label: '手动地址', hint: '连接已有服务 URL + 密码' },
]

function cloneConfig(config: PublicConfig): ConfigDraft {
  return {
    port: config.port,
    autoLoad: config.autoLoad,
    agents: config.agents.map((agent) => ({ ...agent, password: '' })),
  }
}

export function SettingsDialog({
  open,
  config,
  service,
  projects,
  onClose,
  onSave,
  onStartService,
  onDiscover,
  onAutoLoad,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [serviceBusy, setServiceBusy] = useState<'start' | 'discover' | null>(null)
  const [autoLoading, setAutoLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current && config) {
      setDraft(cloneConfig(config))
      setError(null)
      setServiceError(null)
    }
    wasOpen.current = open
  }, [open, config])

  const projectOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: Array<{ canonical: string; label: string }> = []
    for (const project of projects) {
      if (!project.canonical || seen.has(project.canonical)) continue
      seen.add(project.canonical)
      list.push({ canonical: project.canonical, label: project.name || basename(project.canonical) })
    }
    return list
  }, [projects])

  if (!draft) return null

  const allEmpty = draft.agents.every((agent) => !agent.directory.trim())
  const serviceOnline = service?.status === 'online'
  const serviceStarting = service?.status === 'starting' || serviceBusy === 'start'

  const updateAgent = (index: number, patch: Partial<AgentDraft>) => {
    setDraft((current) => {
      if (!current) return current
      return {
        ...current,
        agents: current.agents.map((agent, agentIndex) => (agentIndex === index ? { ...agent, ...patch } : agent)),
      }
    })
  }

  const quickFill = () => {
    if (!draft) return
    const used = new Set(draft.agents.map((agent) => agent.directory).filter(Boolean))
    const available = projectOptions.filter((project) => !used.has(project.canonical))
    setDraft((current) => {
      if (!current) return current
      let cursor = 0
      const agents = current.agents.map((agent) => {
        if (agent.directory.trim()) return agent
        const next = available[cursor]
        cursor += 1
        if (!next) return agent
        return {
          ...agent,
          directory: next.canonical,
          label: agent.label || next.label,
          mode: 'shared' as const,
          follow: true,
        }
      })
      return { ...current, agents }
    })
  }

  const clearAgent = (index: number) => {
    updateAgent(index, {
      directory: '',
      label: '',
      sessionId: undefined,
      password: '',
      mode: 'shared',
      dedicatedPort: undefined,
    })
  }

  const validate = (): string | null => {
    const directories = new Set<string>()
    for (const agent of draft.agents) {
      const directory = agent.directory.trim()
      if (!directory) continue
      const normalized = directory.replace(/[\\/]+$/, '').toLowerCase()
      if (directories.has(normalized)) return `项目目录重复：${directory}`
      directories.add(normalized)
      if (agent.mode === 'manual') {
        const url = (agent.serverUrl ?? '').trim()
        if (!url) return `${agent.label || directory} 选择了手动地址，但没有填写服务 URL`
        if (!/^https?:\/\//i.test(url)) return `${agent.label || directory} 的服务 URL 必须以 http:// 或 https:// 开头`
      }
    }
    return null
  }

  const save = async () => {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        port: draft.port,
        autoLoad: draft.autoLoad,
        agents: draft.agents.map((agent) => ({
          ...agent,
          label: agent.label.trim(),
          directory: agent.directory.trim(),
          serverUrl: (agent.serverUrl ?? '').trim(),
          password: agent.password?.trim() ? agent.password.trim() : undefined,
        })),
      })
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const startService = async () => {
    setServiceBusy('start')
    setServiceError(null)
    try {
      await onStartService()
    } catch (startError) {
      setServiceError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      setServiceBusy(null)
    }
  }

  const discover = async () => {
    setServiceBusy('discover')
    setServiceError(null)
    try {
      await onDiscover()
    } catch (discoverError) {
      setServiceError(discoverError instanceof Error ? discoverError.message : String(discoverError))
    } finally {
      setServiceBusy(null)
    }
  }

  const autoLoad = async () => {
    setAutoLoading(true)
    setServiceError(null)
    try {
      await onAutoLoad()
    } catch (autoError) {
      setServiceError(autoError instanceof Error ? autoError.message : String(autoError))
    } finally {
      setAutoLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-3xl" showCloseButton={false}>
        <DialogHeader className="sticky top-0 z-10 border-b bg-background/95 px-5 py-4 text-left backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mb-1 font-mono text-[9px] tracking-[0.16em] text-muted-foreground">CONNECTIONS</div>
              <DialogTitle className="text-lg">{allEmpty ? '欢迎使用 OpenCode Deck' : '项目与连接'}</DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                最多四个项目槽位。共享服务会自动发现，也可以为单个项目启动独立服务。
              </DialogDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onClose} disabled={saving}>
              <X className="size-3.5" /> 关闭
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          {allEmpty ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-50/70 p-3 dark:bg-amber-950/15">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">先填满你的工作台</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">自动识别正在运行的 OpenCode 窗口；识别不到时再从最近项目里挑。</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => void autoLoad()} disabled={autoLoading}>
                  {autoLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {autoLoading ? '检测中…' : '自动加载'}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={quickFill} disabled={projectOptions.length === 0}>
                  <FolderOpen className="size-3.5" /> 填入最近项目
                </Button>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Server className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">共享后台服务</span>
                  <Badge variant="outline" className={cn('h-5 gap-1 px-1.5 text-[9px]', serviceOnline ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                    <span className={cn('size-1.5 rounded-full', serviceOnline ? 'bg-emerald-500' : 'bg-amber-500')} />
                    {serviceOnline ? '在线' : serviceStarting ? '启动中' : '未连接'}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  {serviceOnline ? (
                    <>
                      <code className="font-mono">{service?.url}</code>
                      <span>v{service?.version ?? '—'}</span>
                      <span>自动发现自 service.json</span>
                    </>
                  ) : (
                    <span>{serviceError || service?.error || '未检测到运行中的 OpenCode 后台服务。'}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[10px]" onClick={() => void autoLoad()} disabled={autoLoading || serviceBusy !== null} title="自动识别正在运行的 OpenCode TUI 并填入空槽位">
                  {autoLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {autoLoading ? '检测中…' : '自动加载'}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => void discover()} disabled={serviceBusy !== null || autoLoading}>
                  {serviceBusy === 'discover' ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  重新发现
                </Button>
                {!serviceOnline ? (
                  <Button type="button" size="sm" className="h-7 text-[10px]" onClick={() => void startService()} disabled={serviceBusy !== null}>
                    {serviceStarting ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}
                    {serviceStarting ? '启动中…' : '启动共享服务'}
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"><PlugZap className="size-3" /> 已连接</span>
                )}
              </div>
            </div>
            {serviceOnline && serviceError ? (
              <div className="mt-2 rounded-md bg-destructive/5 px-2 py-1.5 text-[10px] text-destructive">{serviceError}</div>
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2">
              <div>
                <div className="text-[11px] font-medium">启动时自动加载 OpenCode 窗口</div>
                <div className="text-[9px] text-muted-foreground">检测正在运行的 TUI，自动填入空槽位；已配置的槽位不会被覆盖</div>
              </div>
              <Switch checked={draft.autoLoad} onCheckedChange={(checked) => setDraft((current) => current ? { ...current, autoLoad: checked } : current)} />
            </div>
          </div>

          <Separator />

          <div className="space-y-2.5">
            {draft.agents.map((agent, index) => {
              const mode = MODES.find((option) => option.value === agent.mode) ?? MODES[0]!
              return (
                <section key={agent.id} className={cn('rounded-xl border p-3', agent.directory ? 'bg-muted/15' : 'bg-background')}>
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-md bg-foreground font-mono text-[9px] font-bold text-background">0{index + 1}</span>
                    <span className="text-xs font-semibold">{agent.label || basename(agent.directory) || `项目 ${index + 1}`}</span>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[8px]">{agent.directory ? '已绑定' : '空槽位'}</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 px-1.5 text-[9px] text-muted-foreground hover:text-destructive"
                      onClick={() => clearAgent(index)}
                      disabled={!agent.directory}
                    >
                      <Trash2 className="size-3" /> 清空
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-muted-foreground">显示名称</Label>
                      <Input
                        value={agent.label}
                        placeholder={basename(agent.directory) || `项目 ${index + 1}`}
                        onChange={(event) => updateAgent(index, { label: event.target.value })}
                        maxLength={80}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-muted-foreground">连接方式</Label>
                      <Select
                        value={agent.mode}
                        onValueChange={(value) => {
                          const modeValue = value as PublicAgentConfig['mode']
                          updateAgent(index, {
                            mode: modeValue,
                            ...(modeValue === 'manual' && !agent.serverUrl && service?.url ? { serverUrl: service.url } : {}),
                          })
                        }}
                      >
                        <SelectTrigger size="sm" className="h-8 w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODES.map((option) => (
                            <SelectItem key={option.value} value={option.value} className="text-xs">
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="text-[9px] text-muted-foreground">{mode.hint}</div>
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-[10px] text-muted-foreground">项目目录</Label>
                      <Input
                        value={agent.directory}
                        list="deck-project-paths"
                        placeholder="D:\\projects\\my-app"
                        onChange={(event) => updateAgent(index, { directory: event.target.value })}
                        spellCheck={false}
                        className="h-8 font-mono text-[11px]"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2 sm:col-span-2">
                      <div>
                        <Label className="text-[11px]">跟随最新会话</Label>
                        <div className="text-[9px] text-muted-foreground">关闭后固定当前会话，不随 TUI 切换</div>
                      </div>
                      <Switch checked={agent.follow} onCheckedChange={(checked) => updateAgent(index, { follow: checked })} />
                    </div>

                    {agent.mode === 'manual' ? (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-[10px] text-muted-foreground">服务 URL</Label>
                          <Input
                            value={agent.serverUrl ?? ''}
                            placeholder="http://127.0.0.1:4096"
                            onChange={(event) => updateAgent(index, { serverUrl: event.target.value })}
                            spellCheck={false}
                            className="h-8 font-mono text-[11px]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[10px] text-muted-foreground">服务密码</Label>
                          <Input
                            type="password"
                            value={agent.password ?? ''}
                            placeholder={agent.hasPassword ? '已保存，留空保持不变' : 'Basic Auth 密码'}
                            onChange={(event) => updateAgent(index, { password: event.target.value })}
                            spellCheck={false}
                            className="h-8 text-[11px]"
                          />
                        </div>
                      </>
                    ) : null}

                    {agent.mode === 'dedicated' ? (
                      <div className="rounded-lg border border-dashed bg-background/60 p-2.5 text-[10px] leading-relaxed text-muted-foreground sm:col-span-2">
                        保存后会在该目录自动启动 <code className="font-mono text-foreground">opencode serve</code>，自动分配 4100–4199 端口并托管密码。
                        {agent.dedicatedPort ? <> 当前端口 <code className="font-mono text-foreground">{agent.dedicatedPort}</code>。</> : null}
                      </div>
                    ) : null}
                  </div>
                </section>
              )
            })}
          </div>

          <datalist id="deck-project-paths">
            {projectOptions.map((project) => (
              <option key={project.canonical} value={project.canonical}>{project.label}</option>
            ))}
          </datalist>

          {error ? (
            <Alert variant="destructive" className="py-2">
              <AlertTriangle className="size-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur">
          <span className="text-[9px] text-muted-foreground">配置保存在本机 <code className="font-mono">config.json</code>；密码不会发送到浏览器。</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={saving}>取消</Button>
            <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
              {saving ? '保存中…' : '保存并连接'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
