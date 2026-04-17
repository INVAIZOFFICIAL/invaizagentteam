// 발행대기 → Threads 자동 발행 (매 10분 cron 진입점)
//
// 조건: 상태=발행대기 + 발행일≤now + 직전 발행과 3시간 이상 간격

import type { TextChannel } from 'discord.js';
import { discordClient } from '@/discord/bot.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { publishTextPost } from '@/threads/client.js';
import {
  getPendingContents,
  getPageContentText,
  updateContentPublishInfo,
  getLastPublishedAt,
} from '@/notion/databases/contentDb.js';

const MIN_GAP_HOURS = 3;

export async function publishPendingThreads(): Promise<void> {
  const pending = await getPendingContents();
  if (pending.length === 0) return;

  logger.info('nami', `발행 대기 ${pending.length}건`);

  const lastPublishedAt = await getLastPublishedAt();

  const channel = await discordClient.channels.fetch(env.DISCORD_CHANNEL_NAMI).catch(() => null);
  const textChannel = channel?.isTextBased() ? (channel as TextChannel) : null;

  for (const item of pending) {
    // 3시간 간격 체크
    if (lastPublishedAt) {
      const gapHours = (Date.now() - lastPublishedAt.getTime()) / 3_600_000;
      if (gapHours < MIN_GAP_HOURS) {
        logger.info('nami', `3시간 간격 미충족 (${gapHours.toFixed(1)}h) — 발행 홀드`);
        break;
      }
    }

    const content = await getPageContentText(item.pageId);
    if (!content) {
      logger.warn('nami', `본문 없음 — 스킵: ${item.title}`);
      continue;
    }

    try {
      logger.info('nami', `발행 시작: ${item.title}`);
      const result = await publishTextPost(content);

      const publishUrl = result.permalink ?? `https://www.threads.net/p/${result.id}`;
      await updateContentPublishInfo(item.pageId, publishUrl);

      logger.info('nami', `발행 완료: ${item.title} → ${publishUrl}`);
      textChannel?.send(`🍊 **발행 완료!** ${item.title}\n📎 ${publishUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('nami', `발행 실패: ${item.title}`, err);
      textChannel?.send(`🍊 발행 실패: **${item.title}**\n\`${msg.slice(0, 200)}\``);

      // 발행 실패는 다음 item으로 넘어가지 않고 중단 (중복 발행 방지)
      break;
    }
  }
}
