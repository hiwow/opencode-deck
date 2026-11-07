import { useMemo } from 'react'
import type { MouseEvent } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'

const renderer = new marked.Renderer()

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

renderer.code = ({ text, lang }) => {
  const language = (lang ?? 'text').trim() || 'text'
  return `<div class="code-block"><div class="code-head"><span>${escapeHtml(language)}</span><button type="button" class="code-copy">复制</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`
}

renderer.link = ({ href, title, text }) => {
  const safeHref = href && (/^https?:\/\//i.test(href) || href.startsWith('/') || href.startsWith('#')) ? href : '#'
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer noopener"${titleAttr}>${text}</a>`
}

marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdown(text: string): string {
  if (!text) return ''
  const parsed = marked.parse(text, { async: false, renderer }) as string
  return DOMPurify.sanitize(parsed, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  })
}

interface MarkdownProps {
  text: string
  streaming?: boolean
  className?: string
}

export function Markdown({ text, streaming = false, className }: MarkdownProps) {
  const html = useMemo(() => renderMarkdown(text), [text])

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const button = target.closest('button.code-copy') as HTMLButtonElement | null
    if (!button) return
    const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard.writeText(code).then(() => {
      button.textContent = '已复制'
      button.classList.add('copied')
      setTimeout(() => {
        button.textContent = '复制'
        button.classList.remove('copied')
      }, 1_600)
    })
  }

  if (!text) return null
  return (
    <div
      className={cn(
        'markdown prose prose-sm prose-neutral dark:prose-invert max-w-none text-[13.5px] leading-7',
        streaming && 'is-streaming',
        className,
      )}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
