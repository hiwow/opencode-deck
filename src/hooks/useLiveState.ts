import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  AgentSummary,
  AgentView,
  Bootstrap,
  ProjectInfo,
  PublicConfig,
  ServerEvent,
  ServiceInfo,
} from '../../shared/types'
import { api } from '../lib/api'

export interface LiveState {
  ready: boolean
  connected: boolean
  config: PublicConfig | null
  service: ServiceInfo | null
  projects: ProjectInfo[]
  agents: Record<string, AgentView>
}

const initialState: LiveState = {
  ready: false,
  connected: false,
  config: null,
  service: null,
  projects: [],
  agents: {},
}

function normalizeAgent(agent: AgentView): AgentView {
  return { ...agent, interactions: agent.interactions ?? [], messages: agent.messages ?? [] }
}

function agentsToRecord(agents: AgentView[]): Record<string, AgentView> {
  return Object.fromEntries(agents.map((agent) => [agent.id, normalizeAgent(agent)]))
}

function fromBootstrap(bootstrap: Bootstrap, connected: boolean): LiveState {
  return {
    ready: true,
    connected,
    config: bootstrap.config,
    service: bootstrap.service,
    projects: bootstrap.projects,
    agents: agentsToRecord(bootstrap.agents),
  }
}

function mergeSummary(previous: AgentView | undefined, summary: AgentSummary): AgentView {
  const normalized = normalizeAgent({ ...summary, messages: [] })
  if (!previous) return normalized
  return { ...previous, ...normalized, messages: previous.messages, interactions: normalized.interactions }
}

export function useLiveState() {
  const [state, setState] = useState<LiveState>(initialState)

  const refresh = useCallback(async () => {
    const bootstrap = await api.bootstrap()
    setState((current) => ({ ...fromBootstrap(bootstrap, current.connected), ready: true }))
  }, [])

  useEffect(() => {
    let alive = true
    api.bootstrap()
      .then((bootstrap) => {
        if (!alive) return
        setState((current) => fromBootstrap(bootstrap, current.connected))
      })
      .catch((error: Error) => {
        if (!alive) return
        setState((current) => ({ ...current, ready: true }))
        toast.error(`无法读取监控状态：${error.message}`)
      })

    const source = new EventSource('/api/stream')
    source.onopen = () => {
      if (!alive) return
      setState((current) => ({ ...current, ready: true, connected: true }))
    }
    source.onerror = () => {
      if (!alive) return
      setState((current) => ({ ...current, connected: false }))
    }
    source.onmessage = (message) => {
      if (!alive) return
      let event: ServerEvent
      try {
        event = JSON.parse(message.data) as ServerEvent
      } catch {
        return
      }
      switch (event.type) {
        case 'snapshot':
          setState(fromBootstrap(event.data, true))
          break
        case 'agent':
          setState((current) => ({
            ...current,
            agents: {
              ...current.agents,
              [event.data.id]: mergeSummary(current.agents[event.data.id], event.data),
            },
          }))
          break
        case 'messages':
          setState((current) => {
            const previous = current.agents[event.data.agentId]
            if (!previous) return current
            return {
              ...current,
              agents: {
                ...current.agents,
                [event.data.agentId]: { ...previous, messages: event.data.messages },
              },
            }
          })
          break
        case 'config':
          setState((current) => ({ ...current, config: event.data }))
          break
        case 'service':
          setState((current) => ({ ...current, service: event.data }))
          break
        case 'projects':
          setState((current) => ({ ...current, projects: event.data }))
          break
        case 'notice':
          if (event.data.level === 'error') toast.error(event.data.message, { duration: 9_000 })
          else if (event.data.level === 'success') toast.success(event.data.message)
          else toast.info(event.data.message)
          break
      }
    }

    return () => {
      alive = false
      source.close()
    }
  }, [])

  return { state, refresh }
}
