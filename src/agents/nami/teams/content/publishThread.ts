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
  updateContentPublishInfo,
  getLastPublishedAt,
} from '@/notion/databases/contentDb.js';

const MIN_GAP_HOURS = 3;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 10_000;

async function attemptPublish(
  content: string,
  mediaUrl: string | undefined,
  retries = MAX_RETRIES,
): Promise<{ id: string; permalink?: string }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await publishTextPost(content, mediaUrl);
    } catch (err) {
      lastErr = err;
      if (attempt <= retries) {
        logger.warn('nami', `발행 실패 (시도 ${attempt}/${retries + 1}) — ${RETRY_DELAY_MS / 1000}초 후 재시도`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr;
}

function buildErrorReport(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 300);
  const lines: string[] = [err.message.slice(0, 200)];
  // Threads API 응답 본문이 메시지에 포함돼 있으면 그대로 노출
  const apiMatch = err.message.match(/Threads API \d+ on [^:]+: (.+)/s);
  if (apiMatch) {
    try {
      const parsed = JSON.parse(apiMatch[1]);
      const detail = parsed?.error?.message ?? parsed?.error ?? apiMatch[1];
      lines.push(`API 오류: ${String(detail).slice(0, 150)}`);
    } catch {
      lines.push(`API 응답: ${apiMatch[1].slice(0, 150)}`);
    }
  }
  return lines.join('\n');
}

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

    const content = item.content;
    if (!content) {
      logger.warn('nami', `콘텐츠 속성 비어있음 — 스킵: ${item.title}`);
      continue;
    }

    try {
      logger.info('nami', `발행 시작: ${item.title}${item.mediaUrl ? ' (미디어 첨부)' : ''}`);
      const result = await attemptPublish(content, item.mediaUrl);

      const publishUrl = result.permalink ?? `https://www.threads.net/p/${result.id}`;
      await updateContentPublishInfo(item.pageId, publishUrl);

      logger.info('nami', `발행 완료: ${item.title} → ${publishUrl}`);
      textChannel?.send(`🍊 **발행 완료!** ${item.title}\n📎 ${publishUrl}`);
    } catch (err) {
      logger.error('nami', `발행 실패 (재시도 ${MAX_RETRIES}회 소진): ${item.title}`, err);
      const report = buildErrorReport(err);
      textChannel?.send(
        `🍊 **발행 실패** (${MAX_RETRIES}회 재시도 후 포기): **${item.title}**\n\`\`\`\n${report}\n\`\`\``,
      );
      // 중복 발행 방지를 위해 중단
      break;
    }
  }
}
