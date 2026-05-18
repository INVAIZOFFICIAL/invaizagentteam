// CS 카카오톡 수집 cron — 매일 05:00 DayZero 관련 오픈채팅을 Notion CS DB에 동기화
// 수동 수집은 Claude에게 요청.
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
    schedule: CRON.DAILY_05,
    timeoutMs: 60 * 60 * 1000, // 60분
    fn: async () => {
      const s = await collectKakaoCsConversations();
      logger.info('cron', `CS 카카오 — 감지 ${s.detectedChats}, upsert ${s.upsertedRooms}(신규 ${s.createdRooms}), 메시지 ${s.totalMessages}, 실패 ${s.failedRooms}`);

      const ch = await getChannel();
      if (s.detectedChats === 0) {
        ch?.send('📬 **[초파] CS 카카오 수집 실패** — 카카오톡 DB 접근 불가 (로그인 확인 필요)');
        return;
      }

      const updated = s.upsertedRooms - s.createdRooms;
      const newCount = s.createdRooms;
      const lines = [
        `📬 **[초파] 새벽 CS 수집 완료** (05:00 자동)`,
        `> 총 채팅방 ${s.detectedChats}개 수집`,
        newCount > 0 ? `> 🆕 신규 문의자 ${newCount}명` : '',
        updated > 0 ? `> 🔄 기존 ${updated}명 갱신` : '',
        `> 💬 총 메시지 ${s.totalMessages}건`,
        s.failedRooms > 0 ? `> ⚠️ 실패 ${s.failedRooms}건` : '',
      ].filter(Boolean).join('\n');

      ch?.send(lines);
    },
  });
}
