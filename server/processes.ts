import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { DetectedOpenCodeProcess, OpenCodeProcessKind } from '../shared/types'

const execFileAsync = promisify(execFile)

const TUI_COMMANDS = new Set(['mini'])
const NON_TUI_COMMANDS = new Set([
  'serve',
  'service',
  'acp',
  'api',
  'run',
  'session',
  'debug',
  'auth',
  'mcp',
  'plugin',
  'models',
  'stats',
  'upgrade',
  'update',
  'uninstall',
  'reload',
  'pair',
])
const FLAGS_WITH_VALUE = new Set([
  '--server',
  '--session',
  '-s',
  '--prompt',
  '--log-level',
  '--completions',
  '--model',
  '-m',
])

/**
 * Split a Windows command line without invoking a shell. This is intentionally
 * small: enough for executable paths and quoted project directories, with no
 * environment expansion.
 */
export function splitCommandLine(line: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '\\' && quoted && line[index + 1] === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (/\s/.test(char) && !quoted) {
      if (current) args.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) args.push(current)
  return args
}

function firstPositional(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (FLAGS_WITH_VALUE.has(arg.toLowerCase())) {
      index += 1
      continue
    }
    if (arg.startsWith('-')) continue
    return arg.toLowerCase()
  }
  return undefined
}

function classify(args: string[]): OpenCodeProcessKind {
  const first = firstPositional(args)
  if (!first) return 'tui'
  if (first === 'serve' || first === 'service') return 'serve'
  if (NON_TUI_COMMANDS.has(first)) return 'other'
  if (TUI_COMMANDS.has(first)) return 'tui'
  return 'tui'
}

function existingDirectory(value: string): string | undefined {
  const candidate = value.trim().replace(/^"(.*)"$/, '$1')
  if (!candidate) return undefined
  const absolute = process.platform === 'win32' ? path.win32.isAbsolute(candidate) : path.isAbsolute(candidate)
  if (!absolute) return undefined
  try {
    if (!fs.statSync(candidate).isDirectory()) return undefined
    return process.platform === 'win32' ? path.win32.normalize(candidate) : path.normalize(candidate)
  } catch {
    return undefined
  }
}

function findDirectory(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--') continue
    if (FLAGS_WITH_VALUE.has(arg.toLowerCase())) {
      index += 1
      continue
    }
    if (arg.startsWith('-')) continue
    if (TUI_COMMANDS.has(arg.toLowerCase())) continue
    if (NON_TUI_COMMANDS.has(arg.toLowerCase())) return undefined
    const directory = existingDirectory(arg)
    if (directory) return directory
  }
  return undefined
}

function toProcess(raw: Record<string, unknown>, kind: OpenCodeProcessKind): DetectedOpenCodeProcess | null {
  const pid = Number(raw.ProcessId ?? raw.pid ?? 0)
  const name = String(raw.Name ?? raw.name ?? '')
  const commandLine = String(raw.CommandLine ?? raw.commandLine ?? '')
  if (!Number.isFinite(pid) || pid <= 0 || !commandLine) return null
  const args = splitCommandLine(commandLine)
  // The executable itself may contain spaces; when the process record has a
  // reliable name, find the first token whose basename matches it.
  const executableIndex = args.findIndex((arg) => path.basename(arg).toLowerCase() === name.toLowerCase())
  const cliArgs = executableIndex >= 0 ? args.slice(executableIndex + 1) : args.slice(1)
  const baseKind = classify(cliArgs)
  const standalone = cliArgs.includes('--standalone')
  const remote = cliArgs.some((arg) => arg === '--server' || arg.startsWith('--server='))
  // A TUI pointed at a remote server cannot be loaded through the shared
  // service automatically. Standalone is still useful: its project can be
  // monitored with the shared DB + polling, just not the private SSE stream.
  const resolvedKind = baseKind === 'tui' && remote ? 'other' : baseKind
  return {
    pid,
    name,
    commandLine,
    kind: resolvedKind,
    transport: baseKind === 'tui' ? (standalone ? 'standalone' : remote ? 'remote' : 'shared') : undefined,
    directory: resolvedKind === 'tui' ? findDirectory(cliArgs) : undefined,
  }
}

async function windowsProcesses(): Promise<DetectedOpenCodeProcess[]> {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$items = @(Get-CimInstance Win32_Process -Filter \"Name LIKE 'opencode%'\" | Select-Object ProcessId,Name,CommandLine)",
    "if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress -Depth 4 }",
  ].join('; ')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 5_000,
    windowsHide: true,
    maxBuffer: 1_000_000,
  })
  const text = stdout.trim()
  if (!text) return []
  const parsed = JSON.parse(text) as Record<string, unknown> | Record<string, unknown>[]
  const records = Array.isArray(parsed) ? parsed : [parsed]
  return records
    .map((record) => toProcess(record, 'tui'))
    .filter((process): process is DetectedOpenCodeProcess => Boolean(process))
}

async function unixProcesses(): Promise<DetectedOpenCodeProcess[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args='], {
    timeout: 4_000,
    maxBuffer: 1_000_000,
  })
  const processes: DetectedOpenCodeProcess[] = []
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!match) continue
    const commandLine = match[2]!
    const name = path.basename(splitCommandLine(commandLine)[0] ?? '')
    if (!/^opencode(?:$|[.\s-])/i.test(name)) continue
    const process = toProcess({ ProcessId: Number(match[1]), Name: name, CommandLine: commandLine }, 'tui')
    if (process) processes.push(process)
  }
  return processes
}

export async function detectOpenCodeProcesses(): Promise<DetectedOpenCodeProcess[]> {
  return process.platform === 'win32' ? windowsProcesses() : unixProcesses()
}
