import { env } from '@/config/env.js';
import type { AgentName } from '@/types/agent.types.js';

// 채널 ID → 에이전트명 매핑
export const CHANNEL_AGENT_MAP: Record<string, AgentName> = {
  [env.DISCORD_CHANNEL_LUFFY]:   'luffy',
  [env.DISCORD_CHANNEL_NAMI]:    'nami',
  [env.DISCORD_CHANNEL_ZORO]:    'zoro',
  [env.DISCORD_CHANNEL_USOPP]:   'usopp',
  [env.DISCORD_CHANNEL_SANJI]:   'sanji',
  [env.DISCORD_CHANNEL_CHOPPER]: 'chopper',
};

export function getAgentByChannel(channelId: string): AgentName | null {
  return CHANNEL_AGENT_MAP[channelId] ?? null;
}
