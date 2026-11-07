import type { AgentView, LiveView, MessageView, PublicAgentConfig } from '../../shared/types'

export interface FeedItem {
  key: string
  agentId: string
  agentIndex: number
  role: 'user' | 'assistant'
  created: number
  message?: MessageView
  live?: LiveView
  thinking?: boolean
  streaming?: boolean
}

export interface FeedOptions {
  agents: Record<string, AgentView>
  configAgents: PublicAgentConfig[]
  visible: Set<string>
}

export function buildFeed({ agents, configAgents, visible }: FeedOptions): FeedItem[] {
  const items: FeedItem[] = []
  configAgents.forEach((config, index) => {
    if (!visible.has(config.id)) return
    const agent = agents[config.id]
    if (!agent?.configured) return

    for (const message of agent.messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      items.push({
        key: `${agent.id}:${message.id}`,
        agentId: agent.id,
        agentIndex: index,
        role: message.role,
        created: message.created,
        message,
      })
    }

    const live = agent.live
    const hasLiveContent = Boolean(live && (live.text || live.reasoning || (live.tools?.length ?? 0) > 0))
    const liveAlreadyInMessages = Boolean(live && agent.messages.some((message) => message.id === live.id))
    if (live && hasLiveContent && !liveAlreadyInMessages) {
      items.push({
        key: `${agent.id}:live:${live.id}`,
        agentId: agent.id,
        agentIndex: index,
        role: 'assistant',
        created: live.startedAt,
        live,
        streaming: live.active,
      })
    } else if (agent.busy) {
      items.push({
        key: `${agent.id}:thinking:${live?.startedAt ?? agent.session?.id ?? agent.id}`,
        agentId: agent.id,
        agentIndex: index,
        role: 'assistant',
        created: live?.startedAt ?? Date.now(),
        thinking: true,
        streaming: Boolean(live?.active) || agent.busy,
      })
    }
  })

  return items
    .sort((a, b) => (a.created - b.created) || (a.agentIndex - b.agentIndex))
    .slice(-200)
}

export function agentMessageCount(agent: AgentView | undefined): number {
  if (!agent) return 0
  return agent.messages.filter((message) => message.role === 'user' || message.role === 'assistant').length
}
