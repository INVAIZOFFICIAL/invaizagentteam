// CS 카카오톡 수집 cron — 매 6시간마다 DayZero 관련 오픈채팅을 Notion CS DB에 동기화
//
// 신규 문의자가 [DayZero] 손주완 오픈프로필로 톡을 보내면
// 새 채팅방이 자동 감지되어 Notion 에 새 행으로 등록된다.

import type { TextChannel } from 'discord.js';
import { registerJob } from '@/cron/scheduler.js';
import { CRON } from '@/cron/cronConfig.js';
import { logger } from '@/utils/logger.js';
import { collectKakaoCsConversations } from '@/cs/collectKakaoCs.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';

async function getChannel(): Promise<TextChannel | null> {
  const ch = await discordClient.channels.fetch(env.DISCORD_CHANNEL_CHOPPER).catch(() => null);
  return ch?.isTextBased() ? (ch as TextChannel) : null;
}

export function registerCsCollectJob(): void {
  registerJob({
    name: 'CS:카카오-수집',
    schedule: CRON.EVERY_6H,
    fn: async () => {
      const s = await collectKakaoCsConversations();
      logger.info('cron', `CS 카카오 — 감지 ${s.detectedChats}, upsert ${s.upsertedRooms}(신규 ${s.createdRooms}), 메시지 ${s.totalMessages}, 실패 ${s.failedRooms}`);

      const ch = await getChannel();
      if (s.detectedChats === 0) {
        ch?.send('📬 **CS 카카오 수집** — 카카오톡 DB 접근 실패 (잠김 또는 채팅방 없음)');
        return;
      }

      const updated = s.upsertedRooms - s.createdRooms;
      const parts: string[] = [];
      if (s.createdRooms > 0) parts.push(`신규 문의자 ${s.createdRooms}명`);
      if (updated > 0) parts.push(`기존 ${updated}명 갱신`);
      if (parts.length === 0) parts.push('변경 없음');

      ch?.send(`📬 **CS 카카오 수집 완료** — ${parts.join(', ')} (총 메시지 ${s.totalMessages}건)`);
    },
  });
}
