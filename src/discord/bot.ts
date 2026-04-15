import { Client, GatewayIntentBits, Events } from 'discord.js';
import { env } from '@/config/env.js';
import { handleMessage } from './handlers/messageHandler.js';
import { logger } from '@/utils/logger.js';

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

discordClient.once(Events.ClientReady, (client) => {
  logger.info('discord', `봇 로그인 완료: ${client.user.tag}`);
});

discordClient.on(Events.MessageCreate, async (message) => {
  await handleMessage(message).catch((err) => {
    logger.error('discord', '메시지 처리 중 오류', err);
  });
});

export async function startDiscordBot(): Promise<void> {
  await discordClient.login(env.DISCORD_TOKEN);
}
