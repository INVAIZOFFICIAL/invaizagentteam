import type { Message } from 'discord.js';
import { getAgentByChannel } from '@/discord/channels/channelRouter.js';
import { logger } from '@/utils/logger.js';
import type { BaseAgent } from '@/agents/base/BaseAgent.js';
import type { AgentName } from '@/types/agent.types.js';

// 에이전트 레지스트리 — 봇 시작 시 등록됨
const agentRegistry = new Map<AgentName, BaseAgent>();

export function registerAgent(agent: BaseAgent): void {
  agentRegistry.set(agent.name, agent);
}

export async function handleMessage(message: Message): Promise<void> {
  // 봇 메시지 무시
  if (message.author.bot) return;

  const agentName = getAgentByChannel(message.channelId);
  if (!agentName) return;

  const agent = agentRegistry.get(agentName);
  if (!agent) {
    logger.warn('system', `에이전트 미등록: ${agentName}`);
    return;
  }

  logger.info(agentName, `메시지 수신: ${message.content.slice(0, 50)}...`);
  await agent.handleMessage(message);
}
