import type { Message, TextChannel, DMChannel } from 'discord.js';

export type DiscordMessage = Message;
export type DiscordChannel = TextChannel | DMChannel;

export interface DiscordContext {
  message: DiscordMessage;
  agentName: string;
  channelId: string;
  isDM: boolean;
}
