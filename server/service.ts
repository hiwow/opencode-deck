import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { AgentConfig, ServiceInfo } from '../shared/types'
import { OpenCodeClient, OpenCodeError, readSse } from './opencode'

export interface ServerHandle {
  key: string
  url: string
  password: string
  kind: 'shared' | 'manual' | 'dedicated'
  client: OpenCodeClient
  status: 'online' | 'offline' | 'starting' | 'error'
  version?: string
  error?: string
  sseStatus: 'live' | 'connecting' | 'offline'
  managed: boolean
  port?: number
  directory?: string
  child?: ChildProcess
  abort?: AbortController
  closed: boolean
  sseStarted: boolean
  startPromise?: Promise<ServerHandle>
  probePromise?: Promise<ServerHandle>
  output?: string
}

export interface RegistryHandlers {
  onEvent: (handle: ServerHandle, event: Record<string, any>) => void
  onStatus: (handle: ServerHandle) => void
  onService: (service: ServiceInfo) => void
  onDedicatedReady: (agentId: string, port: number, password: string) => void
}

interface ServiceFile {
  url?: string
  password?: string
  version?: string
  pid?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function resolveServiceFile(): string {
  return process.env.OPENCODE_SERVICE_FILE?.trim()
    || path.join(os.homedir(), '.local', 'state', 'opencode', 'service.json')
}

export function resolveOpencodeBin(): string {
  const candidates = [
    process.env.OPENCODE_BIN?.trim(),
    process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')
      : undefined,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'opencode', 'bin', 'opencode.exe')
      : undefined,
    path.join(os.homedir(), '.cache', 'opencode', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/opt/homebrew/bin/opencode',
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch { /* ignore */ }
  }
  return 'opencode'
}

function keyFor(url: string, password: string): string {
  const hash = crypto.createHash('sha1').update(password).digest('hex').slice(0, 10)
  return `http:${url}|${hash}`
}

function errorText(error: unknown): string {
  if (error instanceof OpenCodeError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

export class ServerRegistry {
  private handles = new Map<string, ServerHandle>()
  private serviceFile = resolveServiceFile()
  private serviceInfo: ServiceInfo = { status: 'offline', file: this.serviceFile, error: '尚未检测共享服务' }
  private serviceCheckedAt = 0
  private discoverPromise: Promise<ServiceInfo> | null = null
  private sharedStartPromise: Promise<ServiceInfo> | null = null
  private stopped = false
  handlers: RegistryHandlers

  constructor(handlers: RegistryHandlers) {
    this.handlers = handlers
  }

  getServiceFile(): string {
    return this.serviceFile
  }

  async discover(force = false): Promise<ServiceInfo> {
    if (!force && Date.now() - this.serviceCheckedAt < 3_000) return this.serviceInfo
    if (this.discoverPromise) return this.discoverPromise
    this.discoverPromise = this.doDiscover().finally(() => { this.discoverPromise = null })
    return this.discoverPromise
  }

  private async doDiscover(): Promise<ServiceInfo> {
    this.serviceCheckedAt = Date.now()
    let file: ServiceFile
    try {
      file = JSON.parse(fs.readFileSync(this.serviceFile, 'utf8')) as ServiceFile
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const previous = this.serviceInfo
      this.serviceInfo = {
        status: 'offline',
        file: this.serviceFile,
        error: code === 'ENOENT' ? '未找到 service.json，共享服务尚未启动' : `读取 service.json 失败：${errorText(error)}`,
      }
      if (JSON.stringify(previous) !== JSON.stringify(this.serviceInfo)) this.handlers.onService(this.serviceInfo)
      return this.serviceInfo
    }

    const url = String(file.url ?? '').trim().replace(/\/+$/, '')
    const password = String(file.password ?? '')
    if (!url || !password) {
      this.serviceInfo = { status: 'offline', file: this.serviceFile, error: 'service.json 缺少 url 或 password' }
      this.handlers.onService(this.serviceInfo)
      return this.serviceInfo
    }

    try {
      const client = new OpenCodeClient(url, password)
      const info = await client.info()
      this.serviceInfo = {
        status: 'online',
        url,
        version: info.version ?? file.version,
        pid: info.pid ?? file.pid,
        file: this.serviceFile,
        managed: true,
      }
    } catch (error) {
      this.serviceInfo = {
        status: 'offline',
        url,
        file: this.serviceFile,
        version: file.version,
        pid: file.pid,
        error: `service.json 指向 ${url}，但连接失败：${errorText(error)}`,
      }
    }
    this.handlers.onService(this.serviceInfo)
    return this.serviceInfo
  }

  private ensureHandle(url: string, password: string, kind: 'shared' | 'manual' | 'dedicated'): ServerHandle {
    const key = kind === 'dedicated' ? '' : keyFor(url, password)
    if (!key) throw new Error('内部错误：dedicated handle 需要单独创建')
    const existing = this.handles.get(key)
    if (existing) return existing
    const handle: ServerHandle = {
      key,
      url,
      password,
      kind,
      client: new OpenCodeClient(url, password),
      status: 'starting',
      sseStatus: 'offline',
      managed: kind === 'shared',
      closed: false,
      sseStarted: false,
    }
    this.handles.set(key, handle)
    return handle
  }

  private notify(handle: ServerHandle): void {
    this.handlers.onStatus(handle)
  }

  private async ensureOnline(handle: ServerHandle): Promise<ServerHandle> {
    if (handle.status === 'online') {
      this.startSse(handle)
      return handle
    }
    if (handle.probePromise) return handle.probePromise
    handle.status = 'starting'
    handle.error = undefined
    this.notify(handle)
    handle.probePromise = (async () => {
      try {
        const info = await handle.client.info()
        handle.version = info.version
        handle.status = 'online'
        handle.error = undefined
        this.startSse(handle)
        this.notify(handle)
        return handle
      } catch (error) {
        handle.status = 'error'
        handle.error = errorText(error)
        this.notify(handle)
        throw new OpenCodeError(handle.error, { status: (error as OpenCodeError).status, code: 'probe' })
      } finally {
        handle.probePromise = undefined
      }
    })()
    return handle.probePromise
  }

  async getShared(): Promise<ServerHandle> {
    const service = await this.discover()
    if (service.status !== 'online' || !service.url) {
      throw new OpenCodeError(service.error ?? '共享服务未运行')
    }
    const handle = this.ensureHandle(service.url, this.readServicePassword(), 'shared')
    if (service.version) handle.version = service.version
    return this.ensureOnline(handle)
  }

  private readServicePassword(): string {
    try {
      const file = JSON.parse(fs.readFileSync(this.serviceFile, 'utf8')) as ServiceFile
      return String(file.password ?? '')
    } catch {
      return ''
    }
  }

  async getManual(agent: AgentConfig): Promise<ServerHandle> {
    const url = String(agent.serverUrl ?? '').trim().replace(/\/+$/, '')
    if (!url) throw new OpenCodeError('未填写服务地址')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new OpenCodeError(`服务地址格式不正确：${url}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new OpenCodeError('服务地址必须是 http:// 或 https://')
    }
    const handle = this.ensureHandle(url, agent.password ?? '', 'manual')
    return this.ensureOnline(handle)
  }

  async getDedicated(agent: AgentConfig): Promise<ServerHandle> {
    const key = `dedicated:${agent.id}`
    const existing = this.handles.get(key)
    if (existing?.startPromise) return existing.startPromise
    if (existing?.status === 'online') {
      this.startSse(existing)
      return existing
    }
    if (existing) {
      try {
        await this.ensureOnline(existing)
        return existing
      } catch {
        await this.stopHandle(existing)
      }
    }
    const adopted = await this.tryAdoptDedicated(agent, key)
    if (adopted) return adopted
    const handle: ServerHandle = {
      key,
      url: '',
      password: agent.dedicatedPassword ?? '',
      kind: 'dedicated',
      client: new OpenCodeClient('http://127.0.0.1:1', agent.dedicatedPassword ?? ''),
      status: 'starting',
      sseStatus: 'offline',
      managed: true,
      directory: agent.directory,
      closed: false,
      sseStarted: false,
      output: '',
    }
    this.handles.set(key, handle)
    handle.startPromise = this.spawnDedicated(agent, handle).finally(() => { handle.startPromise = undefined })
    return handle.startPromise
  }

  private async tryAdoptDedicated(agent: AgentConfig, key: string): Promise<ServerHandle | null> {
    if (!agent.dedicatedPort || !agent.dedicatedPassword) return null
    const url = `http://127.0.0.1:${agent.dedicatedPort}`
    const client = new OpenCodeClient(url, agent.dedicatedPassword)
    try {
      const info = await client.info()
      const handle: ServerHandle = {
        key,
        url,
        password: agent.dedicatedPassword,
        kind: 'dedicated',
        client,
        status: 'online',
        version: info.version,
        sseStatus: 'offline',
        managed: true,
        directory: agent.directory,
        port: agent.dedicatedPort,
        closed: false,
        sseStarted: false,
      }
      this.handles.set(key, handle)
      this.startSse(handle)
      this.notify(handle)
      return handle
    } catch {
      return null
    }
  }

  private async spawnDedicated(agent: AgentConfig, handle: ServerHandle): Promise<ServerHandle> {
    if (!agent.directory) throw new OpenCodeError('未设置项目目录')
    if (!fs.existsSync(agent.directory)) throw new OpenCodeError(`项目目录不存在：${agent.directory}`)

    let port = agent.dedicatedPort && await isPortFree(agent.dedicatedPort)
      ? agent.dedicatedPort
      : await allocatePort()
    if (!port) throw new OpenCodeError('无法分配可用端口')
    const password = agent.dedicatedPassword || crypto.randomBytes(24).toString('base64url')
    const bin = resolveOpencodeBin()
    const env = { ...process.env, OPENCODE_SERVER_PASSWORD: password }

    handle.port = port
    handle.password = password
    handle.client = new OpenCodeClient(`http://127.0.0.1:${port}`, password)
    handle.url = `http://127.0.0.1:${port}`
    handle.output = ''
    handle.status = 'starting'
    this.notify(handle)

    const child = spawn(bin, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd: agent.directory,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    handle.child = child
    handle.closed = false

    const collect = (chunk: Buffer) => {
      handle.output = `${handle.output ?? ''}${chunk.toString('utf8')}`.slice(-16_000)
      const printed = handle.output.match(/server password\s+(\S+)/i)
      if (printed?.[1]) {
        handle.password = printed[1]
        handle.client.password = printed[1]
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (error) => {
      handle.status = 'error'
      handle.error = `独立服务启动失败：${error.message}`
      this.notify(handle)
    })
    child.on('exit', (code) => {
      handle.child = undefined
      if (handle.closed) return
      handle.status = 'offline'
      handle.error = `独立服务已退出（code ${code ?? 'unknown'}）`
      this.notify(handle)
    })

    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (handle.closed) throw new OpenCodeError('独立服务启动已取消')
      const currentStatus: string = handle.status
      if (currentStatus === 'error') throw new OpenCodeError(handle.error ?? '独立服务启动失败')
      if (!handle.child) throw new OpenCodeError(handle.error ?? '独立服务已退出')
      try {
        const info = await handle.client.info()
        handle.version = info.version
        handle.status = 'online'
        handle.error = undefined
        this.startSse(handle)
        this.notify(handle)
        this.handlers.onDedicatedReady(agent.id, port, handle.password)
        return handle
      } catch {
        await sleep(400)
      }
    }

    await this.stopHandle(handle)
    throw new OpenCodeError(`独立服务启动超时（30 秒）。输出：${(handle.output ?? '').slice(-500) || '(无输出)'}`)
  }

  private startSse(handle: ServerHandle): void {
    if (handle.sseStarted || handle.closed) return
    handle.sseStarted = true
    void this.runSseLoop(handle)
  }

  private async runSseLoop(handle: ServerHandle): Promise<void> {
    while (!handle.closed && !this.stopped) {
      const controller = new AbortController()
      handle.abort = controller
      handle.sseStatus = 'connecting'
      this.notify(handle)
      try {
        const response = await handle.client.openEventStream(controller.signal)
        handle.sseStatus = 'live'
        handle.status = 'online'
        handle.error = undefined
        this.notify(handle)
        for await (const event of readSse(response, controller.signal)) {
          if (handle.closed) break
          this.handlers.onEvent(handle, event)
        }
        if (handle.closed) break
        handle.sseStatus = 'offline'
        this.notify(handle)
      } catch (error) {
        if (handle.closed || controller.signal.aborted) break
        handle.sseStatus = 'offline'
        this.notify(handle)
        handle.error = handle.error ?? errorText(error)
      }
      if (handle.closed) break
      await sleep(2_500)
    }
  }

  async startSharedService(): Promise<ServiceInfo> {
    const current = await this.discover(true)
    if (current.status === 'online') return current
    if (this.sharedStartPromise) return this.sharedStartPromise
    this.sharedStartPromise = (async () => {
      this.handlers.onService({ status: 'starting', file: this.serviceFile, error: '正在启动共享服务…' })
      const bin = resolveOpencodeBin()
      let commandOutput = ''
      try {
        const result = await runCommand(bin, ['service', 'start'], 20_000)
        commandOutput = `${result.stdout}\n${result.stderr}`.trim()
      } catch (error) {
        throw new OpenCodeError(`启动共享服务失败：${errorText(error)}`)
      }
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        await sleep(600)
        const service = await this.discover(true)
        if (service.status === 'online') return service
      }
      throw new OpenCodeError(`共享服务启动超时。${commandOutput ? `命令输出：${commandOutput.slice(-600)}` : ''}`)
    })().finally(() => { this.sharedStartPromise = null })
    return this.sharedStartPromise
  }

  async stopSharedService(): Promise<ServiceInfo> {
    const bin = resolveOpencodeBin()
    try {
      await runCommand(bin, ['service', 'stop'], 15_000)
    } catch (error) {
      throw new OpenCodeError(`停止共享服务失败：${errorText(error)}`)
    }
    await sleep(500)
    return this.discover(true)
  }

  private async stopHandle(handle: ServerHandle): Promise<void> {
    handle.closed = true
    try { handle.abort?.abort() } catch { /* ignore */ }
    const child = handle.child
    if (child && child.exitCode === null) {
      try { child.kill() } catch { /* ignore */ }
      await sleep(400)
      if (child.exitCode === null && process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
        } catch { /* ignore */ }
      }
    }
    this.handles.delete(handle.key)
    handle.status = 'offline'
    this.notify(handle)
  }

  async retain(keys: Set<string>): Promise<void> {
    const toStop = [...this.handles.values()].filter((handle) => !keys.has(handle.key))
    await Promise.allSettled(toStop.map((handle) => this.stopHandle(handle)))
  }

  async stopAll(): Promise<void> {
    this.stopped = true
    await Promise.allSettled([...this.handles.values()].map((handle) => this.stopHandle(handle)))
    this.handles.clear()
  }

  listHandles(): ServerHandle[] {
    return [...this.handles.values()]
  }
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function allocatePort(): Promise<number | null> {
  for (let port = 4100; port <= 4199; port += 1) {
    if (await isPortFree(port)) return port
  }
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(null))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => resolve(port))
    })
  })
}

function runCommand(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* ignore */ }
      reject(new Error(`命令执行超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-8_000) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}
