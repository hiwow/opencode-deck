export function basename(value: string | undefined | null): string {
  if (!value) return ''
  const normalized = value.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

export function relativeTime(timestamp: number | undefined | null, now = Date.now()): string {
  if (!timestamp) return '—'
  const diff = Math.max(0, now - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 8) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function clockTime(timestamp: number | undefined | null): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function modelLabel(model: { id?: string; providerID?: string; variant?: string } | undefined | null): string {
  if (!model?.id) return '默认模型'
  const variant = model.variant && model.variant !== 'default' ? ` · ${model.variant}` : ''
  return `${model.id}${variant}`
}

export function formatCost(cost: number | undefined | null): string {
  if (!cost) return '免费'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(3)}`
}

export function compactNumber(value: number | undefined | null): string {
  if (!value) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function truncate(value: string, max = 120): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

export function prettyUnknown(value: unknown, max = 2_000): string {
  if (value === undefined || value === null) return ''
  let text: string
  if (typeof value === 'string') text = value
  else {
    try { text = JSON.stringify(value, null, 2) } catch { text = String(value) }
  }
  return text.length > max ? `${text.slice(0, max)}\n…` : text
}
